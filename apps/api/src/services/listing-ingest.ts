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

/**
 * Persist scrape results for one routine:
 * - Upsert permanent listing rows
 * - Insert a sighting for every observation
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
    } else {
      const priceChanged =
        price != null && row.lastPrice != null && price !== row.lastPrice;

      const updates: Partial<typeof listings.$inferInsert> = {
        url,
        name,
        imageUrl: imageUrl ?? row.imageUrl,
        lastSeenAt: now,
        lastPrice: price,
        lastData: data,
        updatedAt: now,
        status: "active",
      };

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
          notified: false,
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
          // If user had dismissed, a price change is worth notifying again
          notified: false,
          createdAt: now,
        });
        eventsCreated++;
      }

      await db.update(listings).set(updates).where(eq(listings.id, id));
    }

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
          notified: false,
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
