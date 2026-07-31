import { and, eq, inArray } from "drizzle-orm";
import {
  listingEvents,
  listingSightings,
  listings,
  scrapeRoutineResults,
  type Database,
} from "@watcher/db";
import type { ScrapedItem, ScrapeJobResult } from "@watcher/shared";
import { log } from "../lib/time";

export interface IngestRoutineInput {
  scrapeRunId: number;
  searchRoutineId: number;
  engineSlug: string;
  result: ScrapeJobResult;
}

export interface IngestRoutineOutput {
  itemsSeen: number;
  sightingsCreated: number;
  eventsCreated: number;
  markedMissing: number;
  complete: boolean;
}

function priceOf(item: ScrapedItem): number | null {
  if (item.price === null || item.price === undefined) return null;
  const n = Number(item.price);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

/** True when scraped fields differ from the last stored listing snapshot. */
function listingChanged(
  row: typeof listings.$inferSelect,
  next: {
    price: number | null;
    name: string;
    url: string;
    imageUrl: string | null;
  },
): boolean {
  if (next.price !== row.lastPrice) return true;
  if (next.name !== row.name) return true;
  if (next.url !== row.url) return true;
  // Scrapers sometimes omit image; only treat an explicit new URL as a change
  if (next.imageUrl != null && next.imageUrl !== row.imageUrl) return true;
  return false;
}

/**
 * Persist scrape results for one routine:
 * - Upsert permanent listing rows (always refresh lastSeenAt when observed)
 * - Insert a sighting only on first see or when listing content changed
 * - Emit first_seen / price_change / reappeared events
 * - Only if scrape is complete: mark previously seen active items as missing
 */
export async function ingestRoutineScrape(
  db: Database,
  input: IngestRoutineInput,
): Promise<IngestRoutineOutput> {
  const { scrapeRunId, searchRoutineId, engineSlug, result } = input;
  const now = new Date();
  let sightingsCreated = 0;
  let eventsCreated = 0;
  let markedMissing = 0;

  const seenIds = new Set<string>();

  // Even on incomplete scrapes we record what we successfully saw
  for (const item of result.items) {
    const id = String(item.id);
    if (!id) continue;
    seenIds.add(id);

    const price = priceOf(item);
    const name = String(item.name || "Untitled");
    const url = String(item.url || "#");
    const imageUrl = item.image ? String(item.image) : null;
    const data = { ...item } as Record<string, unknown>;

    const existing = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
    const row = existing[0];

    let shouldRecordSighting = false;

    if (!row) {
      await db.insert(listings).values({
        id,
        engineSlug,
        url,
        name,
        imageUrl,
        status: "active",
        firstSeenAt: now,
        lastSeenAt: now,
        lastPrice: price,
        lastData: data,
        updatedAt: now,
      });

      await db.insert(listingEvents).values({
        listingId: id,
        scrapeRunId,
        searchRoutineId,
        kind: "first_seen",
        oldPrice: null,
        newPrice: price,
        notified: false,
        createdAt: now,
      });
      eventsCreated++;
      shouldRecordSighting = true;
    } else {
      const contentChanged = listingChanged(row, { price, name, url, imageUrl });
      const priceChanged =
        price != null && row.lastPrice != null && price !== row.lastPrice;

      // Always bump presence; only refresh content fields when they changed
      // (avoids rewriting identical jsonb every scrape)
      const updates: Partial<typeof listings.$inferInsert> = {
        lastSeenAt: now,
        updatedAt: now,
        status: "active",
      };

      if (contentChanged) {
        updates.url = url;
        updates.name = name;
        updates.imageUrl = imageUrl ?? row.imageUrl;
        updates.lastPrice = price;
        updates.lastData = data;
      }

      // Price change re-opens interest (same listing, "new" deal to the user)
      if (priceChanged && row.notInterested) {
        updates.notInterested = false;
        updates.notInterestedAt = null;
        log("Ingest", `listing ${id}: price change cleared not_interested`);
      }

      if (row.status === "missing") {
        await db.insert(listingEvents).values({
          listingId: id,
          scrapeRunId,
          searchRoutineId,
          kind: "reappeared",
          oldPrice: row.lastPrice,
          newPrice: price,
          // Push only for first_seen — reappear is tracked but silent
          notified: true,
          createdAt: now,
        });
        eventsCreated++;
      } else if (priceChanged) {
        await db.insert(listingEvents).values({
          listingId: id,
          scrapeRunId,
          searchRoutineId,
          kind: "price_change",
          oldPrice: row.lastPrice,
          newPrice: price,
          // Push only for first_seen
          notified: true,
          createdAt: now,
        });
        eventsCreated++;
      }

      await db.update(listings).set(updates).where(eq(listings.id, id));

      // Sightings are a change log / price history — skip identical re-observations
      shouldRecordSighting = contentChanged;
    }

    if (shouldRecordSighting) {
      await db.insert(listingSightings).values({
        listingId: id,
        scrapeRunId,
        searchRoutineId,
        observedAt: now,
        price,
        data,
      });
      sightingsCreated++;
    }
  }

  // Missing detection — only when this routine scrape is complete and ok
  if (result.ok && result.complete) {
    // Listings previously observed under this routine that are still active
    const previouslySeen = await db
      .selectDistinct({ listingId: listingSightings.listingId })
      .from(listingSightings)
      .where(eq(listingSightings.searchRoutineId, searchRoutineId));

    const candidateIds = previouslySeen
      .map((r) => r.listingId)
      .filter((id) => !seenIds.has(id));

    if (candidateIds.length > 0) {
      const stillActive = await db
        .select({ id: listings.id })
        .from(listings)
        .where(and(inArray(listings.id, candidateIds), eq(listings.status, "active")));

      for (const { id } of stillActive) {
        await db
          .update(listings)
          .set({ status: "missing", updatedAt: now })
          .where(eq(listings.id, id));

        await db.insert(listingEvents).values({
          listingId: id,
          scrapeRunId,
          searchRoutineId,
          kind: "missing",
          oldPrice: null,
          newPrice: null,
          // Removals must not trigger push
          notified: true,
          createdAt: now,
        });
        eventsCreated++;
        markedMissing++;
      }
    }
  } else if (!result.complete) {
    log(
      "Ingest",
      `routine ${searchRoutineId}: incomplete scrape (failed pages=${result.pagesFailed}) — skip missing detection`,
    );
  }

  await db.insert(scrapeRoutineResults).values({
    scrapeRunId,
    searchRoutineId,
    engineSlug,
    complete: result.ok && result.complete,
    pagesPlanned: result.pagesPlanned,
    pagesFetched: result.pagesFetched,
    pagesFailed: result.pagesFailed,
    itemsSeen: seenIds.size,
    error: result.error ?? null,
  });

  log(
    "Ingest",
    `routine ${searchRoutineId}: seen=${seenIds.size} sightings=${sightingsCreated} events=${eventsCreated} missing=${markedMissing} complete=${result.complete}`,
  );

  return {
    itemsSeen: seenIds.size,
    sightingsCreated,
    eventsCreated,
    markedMissing,
    complete: result.ok && result.complete,
  };
}
