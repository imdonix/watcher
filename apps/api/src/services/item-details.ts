import { asc, eq, isNull } from "drizzle-orm";
import {
  listings,
  scrapeRoutineResults,
  type Database,
} from "@watcher/db";
import { ITEM_DETAILS_JOB_SLUG, type ListingItemDetails } from "@watcher/shared";
import { log, logError } from "../lib/time";
import { runScrapeItem } from "./scraper-client";

/** Max item-page scrapes per run (one-time queue drain). */
const DETAILS_BATCH = 30;

export interface ItemDetailsJobResult {
  planned: number;
  fetched: number;
  failed: number;
  complete: boolean;
}

export type ItemDetailsProgressFn = (info: {
  index: number;
  total: number;
  listingId: string;
  engineSlug: string;
  name: string;
}) => void;

/**
 * Special scrape-run job: visit listing pages that have never had details scraped.
 * Engines fully own the detail payload shape. Each listing is attempted once
 * (`details_scraped_at` set on success or failure — no re-scrape).
 */
export async function runItemDetailsJob(
  db: Database,
  scrapeRunId: number,
  onProgress?: ItemDetailsProgressFn,
): Promise<ItemDetailsJobResult> {
  const pending = await db
    .select({
      id: listings.id,
      url: listings.url,
      engineSlug: listings.engineSlug,
      name: listings.name,
      imageUrl: listings.imageUrl,
      lastPrice: listings.lastPrice,
    })
    .from(listings)
    .where(isNull(listings.detailsScrapedAt))
    .orderBy(asc(listings.firstSeenAt))
    .limit(DETAILS_BATCH);

  const planned = pending.length;
  let fetched = 0;
  let failed = 0;

  if (planned === 0) {
    log("Details", "no listings pending item scrape");
    return { planned: 0, fetched: 0, failed: 0, complete: true };
  }

  log("Details", `item-details job: ${planned} listing(s) pending`);

  for (let i = 0; i < pending.length; i++) {
    const row = pending[i]!;
    onProgress?.({
      index: i + 1,
      total: planned,
      listingId: row.id,
      engineSlug: row.engineSlug,
      name: row.name,
    });
    const now = new Date();
    try {
      const result = await runScrapeItem({
        engine: row.engineSlug,
        url: row.url,
        listingId: row.id,
      });

      if (result.ok && result.details) {
        const details = result.details as ListingItemDetails;
        const updates: Partial<typeof listings.$inferInsert> = {
          details: details as Record<string, unknown>,
          detailsScrapedAt: now,
          updatedAt: now,
        };

        // Soft upgrades from the detail page when list data was thin
        if (result.name && result.name.trim() && result.name !== "Untitled") {
          updates.name = result.name.trim();
        }
        if (result.price != null && Number.isFinite(result.price)) {
          updates.lastPrice = Math.floor(result.price);
        }
        if (result.image && !row.imageUrl) {
          updates.imageUrl = result.image;
        } else if (details.images?.[0] && !row.imageUrl) {
          updates.imageUrl = details.images[0];
        }

        await db.update(listings).set(updates).where(eq(listings.id, row.id));
        fetched++;
        log("Details", `ok ${row.engineSlug} ${row.id}`);
      } else {
        // Mark attempted so we never hammer a dead URL forever
        await db
          .update(listings)
          .set({
            details: {
              error: result.error || "detail scrape failed",
              engine: row.engineSlug,
            },
            detailsScrapedAt: now,
            updatedAt: now,
          })
          .where(eq(listings.id, row.id));
        failed++;
        logError("Details", `fail ${row.engineSlug} ${row.id}: ${result.error}`);
      }
    } catch (err) {
      failed++;
      logError("Details", `exception ${row.id}: ${err}`);
      try {
        await db
          .update(listings)
          .set({
            details: { error: String(err) },
            detailsScrapedAt: now,
            updatedAt: now,
          })
          .where(eq(listings.id, row.id));
      } catch {
        /* ignore */
      }
    }
  }

  const complete = failed === 0;
  await db.insert(scrapeRoutineResults).values({
    scrapeRunId,
    searchRoutineId: null,
    engineSlug: ITEM_DETAILS_JOB_SLUG,
    complete,
    pagesPlanned: planned,
    pagesFetched: fetched,
    pagesFailed: failed,
    itemsSeen: fetched,
    error: failed > 0 ? `${failed}/${planned} item detail scrapes failed` : null,
  });

  log(
    "Details",
    `item-details done planned=${planned} ok=${fetched} failed=${failed}`,
  );

  return { planned, fetched, failed, complete };
}
