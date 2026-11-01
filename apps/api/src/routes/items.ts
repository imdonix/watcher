import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { listingEvents, listingSightings, listings, type Database } from "@watcher/db";
import { formatPrice, type DealMarket, type ListingDeal, type ListingState } from "@watcher/shared";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { aiConfigured, evaluateListing, loadAiConfig } from "../services/ai";
import {
  computeDeals,
  loadSightingStatFor,
  loadSightingStats,
  MarketCheckError,
  refreshMarketCheck,
} from "../services/deals";
import { log, logError } from "../lib/time";

/** Deduplicate concurrent Market checks for the same listing. */
const marketChecks = new Map<string, Promise<DealMarket>>();

function listingState(row: typeof listings.$inferSelect): ListingState {
  if (row.status === "deleted") return "deleted";
  if (row.notInterested) {
    return row.notInterestedReason === "ai" ? "ruled_out" : "not_interested";
  }
  return "interesting";
}

function mapListing(
  row: typeof listings.$inferSelect,
  sightingCount = 0,
  deal: ListingDeal | null = null,
) {
  const available = row.status === "active" && !row.notInterested;
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    image: row.imageUrl,
    price: row.lastPrice,
    priceFormatted: formatPrice(row.lastPrice),
    engineSlug: row.engineSlug,
    status: row.status,
    state: listingState(row),
    notInterested: row.notInterested,
    notInterestedAt: row.notInterestedAt,
    notInterestedReason: (row.notInterestedReason as "user" | "ai" | null) ?? null,
    available,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    deletedAt: row.deletedAt,
    sightingCount,
    found: row.lastSeenAt,
    details: row.details ?? null,
    detailsScrapedAt: row.detailsScrapedAt ?? null,
    aiVerdict: (row.aiVerdict as "pass" | "fail" | null) ?? null,
    aiScore: row.aiScore ?? null,
    aiReason: row.aiReason ?? null,
    aiModel: row.aiModel ?? null,
    aiEvaluatedAt: row.aiEvaluatedAt ?? null,
    prevPrice: row.prevPrice ?? null,
    priceChangedAt: row.priceChangedAt ?? null,
    targetPrice: row.targetPrice ?? null,
    deal,
  };
}

export function itemRoutes(db: Database) {
  const app = new Hono<AuthEnv>();

  app.use("*", requireAuth);

  app.get("/", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
    const filter = c.req.query("status"); // interesting | hidden | deleted | all
    log("API", `Listings list filter=${filter ?? "all"}`);

    let rows = await db.select().from(listings).orderBy(desc(listings.lastSeenAt)).limit(limit * 2);

    if (filter === "active" || filter === "available" || filter === "interesting") {
      rows = rows.filter((r) => r.status === "active" && !r.notInterested);
    } else if (filter === "deleted") {
      rows = rows.filter((r) => r.status === "deleted");
    } else if (
      filter === "dismissed" ||
      filter === "not_interested" ||
      filter === "hidden"
    ) {
      rows = rows.filter((r) => r.notInterested && r.status !== "deleted");
    } else if (filter === "unavailable") {
      rows = rows.filter((r) => r.status === "deleted" || r.notInterested);
    }

    rows = rows.slice(0, limit);

    const stats = await loadSightingStats(db);
    const deals = await computeDeals(db, rows, stats);

    return c.json(
      rows.map((row) =>
        mapListing(
          row,
          stats.get(row.id)?.count ?? 0,
          deals.get(row.id) ?? null,
        ),
      ),
    );
  });

  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const [row] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
    if (!row) return c.json({ error: "Not found" }, 404);

    const sightings = await db
      .select()
      .from(listingSightings)
      .where(eq(listingSightings.listingId, id))
      .orderBy(desc(listingSightings.observedAt))
      .limit(200);

    const events = await db
      .select()
      .from(listingEvents)
      .where(eq(listingEvents.listingId, id))
      .orderBy(desc(listingEvents.createdAt))
      .limit(100);

    // Chronological price series (oldest → newest) for charts
    const priceHistory = [...sightings]
      .reverse()
      .filter((s) => s.price != null)
      .map((s) => ({
        at: s.observedAt,
        price: s.price,
        scrapeRunId: s.scrapeRunId,
      }));

    const prices = sightings
      .map((s) => s.price)
      .filter((p): p is number => p != null);
    const stats = new Map([
      [
        id,
        {
          count: sightings.length,
          lowest: prices.length > 0 ? Math.min(...prices) : null,
          highest: prices.length > 0 ? Math.max(...prices) : null,
        },
      ],
    ]);
    const deals = await computeDeals(db, [row], stats);

    return c.json({
      listing: mapListing(row, sightings.length, deals.get(id) ?? null),
      sightings,
      events,
      priceHistory,
    });
  });

  /**
   * Run a fresh Árukereső shop-price lookup for this listing.
   * Kept out of GET so the detail page renders immediately from cache.
   */
  app.post("/:id/market", async (c) => {
    const id = c.req.param("id");
    const [row] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
    if (!row) return c.json({ error: "Not found" }, 404);
    if (row.lastPrice == null || row.lastPrice <= 0) {
      return c.json({ error: "Listing has no price to compare" }, 400);
    }

    try {
      let pending = marketChecks.get(id);
      if (!pending) {
        pending = refreshMarketCheck(db, row).finally(() => marketChecks.delete(id));
        marketChecks.set(id, pending);
      }
      const market = await pending;
      log("API", `market check ${id}: shop ${market.shopPrice} vs resell ${market.resellPrice}`);

      const stats = new Map([[id, await loadSightingStatFor(db, id)]]);
      const deals = await computeDeals(db, [row], stats);
      return c.json({
        market,
        listing: mapListing(
          row,
          stats.get(id)?.count ?? 0,
          deals.get(id) ?? null,
        ),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("API", `market check failed for ${id}: ${message}`);
      if (err instanceof MarketCheckError) {
        // Expected "no shop price" outcome, not a gateway error.
        return c.json({ market: null, error: message }, 200);
      }
      return c.json({ error: message }, 502);
    }
  });

  app.post("/:id/not-interested", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { interested?: boolean };
    // interested: true → clear dismiss; false/omitted → mark not interested
    const markDismissed = body.interested !== true;

    const [row] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
    if (!row) return c.json({ error: "Not found" }, 404);

    const now = new Date();
    const [updated] = await db
      .update(listings)
      .set({
        notInterested: markDismissed,
        notInterestedAt: markDismissed ? now : null,
        notInterestedReason: markDismissed ? "user" : null,
        updatedAt: now,
      })
      .where(eq(listings.id, id))
      .returning();

    log("API", `listing ${id} notInterested=${markDismissed}`);
    return c.json(mapListing(updated));
  });

  /** Set or clear the per-listing price alert threshold. */
  app.post("/:id/target-price", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { targetPrice?: unknown };
    const raw = body.targetPrice;

    let target: number | null;
    if (raw === null || raw === undefined || raw === "") {
      target = null;
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 100_000_000) {
        return c.json(
          { error: "targetPrice must be an integer between 0 and 100000000 (or null to clear)" },
          400,
        );
      }
      target = n;
    }

    const [row] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
    if (!row) return c.json({ error: "Not found" }, 404);

    const now = new Date();
    const targetChanged = row.targetPrice !== target;
    const [updated] = await db
      .update(listings)
      .set({ targetPrice: target, updatedAt: now })
      .where(eq(listings.id, id))
      .returning();

    // Current price already at/below the new target → alert right away,
    // but only when the threshold actually changed (no repeat spam on re-save)
    if (target != null && targetChanged && row.lastPrice != null && row.lastPrice <= target) {
      await db.insert(listingEvents).values({
        listingId: id,
        scrapeRunId: null,
        searchRoutineId: null,
        kind: "target_hit",
        oldPrice: row.lastPrice,
        newPrice: row.lastPrice,
        notified: false,
        createdAt: now,
      });
      log("API", `listing ${id}: target price ${target} already met (${row.lastPrice})`);
    }

    log("API", `listing ${id} targetPrice=${target ?? "clear"}`);
    return c.json(mapListing(updated ?? row));
  });

  app.get("/:id/sightings", async (c) => {
    const id = c.req.param("id");
    const rows = await db
      .select()
      .from(listingSightings)
      .where(eq(listingSightings.listingId, id))
      .orderBy(desc(listingSightings.observedAt))
      .limit(200);
    return c.json(rows);
  });

  /** Manual AI evaluation / re-evaluation of a single listing. */
  app.post("/:id/ai-evaluate", async (c) => {
    const id = c.req.param("id");
    const [row] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
    if (!row) return c.json({ error: "Not found" }, 404);

    const cfg = await loadAiConfig(db);
    if (!aiConfigured(cfg)) {
      return c.json(
        { error: "AI evaluation is disabled or missing an API key (see Settings)" },
        400,
      );
    }

    try {
      log("API", `manual AI evaluation for ${id}`);
      const verdict = await evaluateListing(db, cfg, row);
      const [updated] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
      return c.json({ verdict, listing: mapListing(updated ?? row) });
    } catch (err) {
      logError("API", `AI evaluation failed for ${id}: ${err}`);
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 502);
    }
  });

  return app;
}
