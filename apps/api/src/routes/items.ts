import { Hono } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import { listingEvents, listingSightings, listings, type Database } from "@watcher/db";
import { formatPrice } from "@watcher/shared";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { log } from "../lib/time";

function mapListing(row: typeof listings.$inferSelect, sightingCount = 0) {
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
    notInterested: row.notInterested,
    notInterestedAt: row.notInterestedAt,
    available,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    sightingCount,
    found: row.lastSeenAt,
  };
}

export function itemRoutes(db: Database) {
  const app = new Hono<AuthEnv>();

  app.use("*", requireAuth);

  app.get("/", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
    const filter = c.req.query("status"); // active | missing | dismissed | available | all
    log("API", `Listings list filter=${filter ?? "all"}`);

    let rows = await db.select().from(listings).orderBy(desc(listings.lastSeenAt)).limit(limit * 2);

    if (filter === "active" || filter === "available") {
      rows = rows.filter((r) => r.status === "active" && !r.notInterested);
    } else if (filter === "missing") {
      rows = rows.filter((r) => r.status === "missing");
    } else if (filter === "dismissed" || filter === "not_interested") {
      rows = rows.filter((r) => r.notInterested);
    } else if (filter === "unavailable") {
      rows = rows.filter((r) => r.status === "missing" || r.notInterested);
    }

    rows = rows.slice(0, limit);

    const counts = await db
      .select({
        listingId: listingSightings.listingId,
        n: sql<number>`count(*)::int`,
      })
      .from(listingSightings)
      .groupBy(listingSightings.listingId);

    const countMap = new Map(counts.map((c) => [c.listingId, c.n]));

    return c.json(rows.map((row) => mapListing(row, countMap.get(row.id) ?? 0)));
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

    return c.json({
      listing: mapListing(row, sightings.length),
      sightings,
      events,
      priceHistory,
    });
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
        updatedAt: now,
      })
      .where(eq(listings.id, id))
      .returning();

    log("API", `listing ${id} notInterested=${markDismissed}`);
    return c.json(mapListing(updated));
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

  return app;
}
