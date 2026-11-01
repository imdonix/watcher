import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  or,
} from "drizzle-orm";
import {
  listingEvents,
  listingSightings,
  listings,
  scrapeRoutineResults,
  type Database,
} from "@watcher/db";
import { ITEM_VERIFICATION_JOB_SLUG } from "@watcher/shared";
import { log, logError } from "../lib/time";
import { runScrapeItem } from "./scraper-client";

/** Missing-item checks are detail scrapes; keep the batch modest. */
const VERIFY_BATCH = 10;
/** Re-verify a still-existing missing item after this many days. */
const VERIFY_MAX_AGE_DAYS = 7;

export interface ItemVerificationJobResult {
  planned: number;
  exists: number;
  deleted: number;
  failed: number;
  complete: boolean;
  skipped: boolean;
}

export type ItemVerificationProgressFn = (info: {
  index: number;
  total: number;
  listingId: string;
  engineSlug: string;
  name: string;
}) => void;

/**
 * Scrape-run job: for listings that disappeared from a routine's result list,
 * open the item page once. HTTP 404/410 → permanently `deleted`. A live page
 * (even if the price no longer matches the routine filters) stays `missing`.
 */
export async function runItemVerificationJob(
  db: Database,
  scrapeRunId: number,
  routineIds: number[],
  onProgress?: ItemVerificationProgressFn,
): Promise<ItemVerificationJobResult> {
  if (routineIds.length === 0) {
    return {
      planned: 0,
      exists: 0,
      deleted: 0,
      failed: 0,
      complete: true,
      skipped: true,
    };
  }

  // Listings that were previously observed by one of this run's routines.
  const links = await db
    .select({
      listingId: listingSightings.listingId,
      routineId: listingSightings.searchRoutineId,
      observedAt: listingSightings.observedAt,
    })
    .from(listingSightings)
    .where(inArray(listingSightings.searchRoutineId, routineIds))
    .orderBy(desc(listingSightings.observedAt));

  const routineByListing = new Map<string, number>();
  for (const link of links) {
    if (link.routineId == null) continue;
    if (!routineByListing.has(link.listingId)) {
      routineByListing.set(link.listingId, link.routineId);
    }
  }

  const ids = [...routineByListing.keys()];
  if (ids.length === 0) {
    log("Verify", "no listings associated with this run's routines");
    return {
      planned: 0,
      exists: 0,
      deleted: 0,
      failed: 0,
      complete: true,
      skipped: true,
    };
  }

  const cutoff = new Date(
    Date.now() - VERIFY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
  );
  const pending = await db
    .select()
    .from(listings)
    .where(
      and(
        inArray(listings.id, ids),
        eq(listings.status, "missing"),
        ne(listings.url, "#"),
        or(
          isNull(listings.lastVerifiedAt),
          lt(listings.lastVerifiedAt, cutoff),
        ),
      ),
    )
    // Non-hidden items first, then the most recently seen.
    .orderBy(asc(listings.notInterested), desc(listings.lastSeenAt))
    .limit(VERIFY_BATCH);

  const planned = pending.length;
  if (planned === 0) {
    log("Verify", "no missing listings pending verification");
    return {
      planned: 0,
      exists: 0,
      deleted: 0,
      failed: 0,
      complete: true,
      skipped: true,
    };
  }

  log("Verify", `missing-item verification: ${planned} listing(s) pending`);

  let exists = 0;
  let deleted = 0;
  let failed = 0;

  for (let i = 0; i < planned; i++) {
    const row = pending[i]!;
    onProgress?.({
      index: i + 1,
      total: planned,
      listingId: row.id,
      engineSlug: row.engineSlug,
      name: row.name,
    });

    try {
      const result = await runScrapeItem({
        engine: row.engineSlug,
        url: row.url,
        listingId: row.id,
      });
      const now = new Date();

      if (result.deleted) {
        await db
          .update(listings)
          .set({
            status: "deleted",
            deletedAt: now,
            lastVerifiedAt: now,
            updatedAt: now,
          })
          .where(eq(listings.id, row.id));

        await db.insert(listingEvents).values({
          listingId: row.id,
          scrapeRunId,
          searchRoutineId: routineByListing.get(row.id) ?? null,
          kind: "deleted",
          oldPrice: row.lastPrice,
          newPrice: null,
          notified: true,
          createdAt: now,
        });
        deleted++;
        log("Verify", `deleted ${row.id} (${row.engineSlug})`);
        continue;
      }

      const hasPage = Boolean(
        result.ok && (result.details || result.name || result.price != null),
      );
      if (!hasPage) {
        // Transient failure: keep missing and retry after the age window.
        await db
          .update(listings)
          .set({ lastVerifiedAt: now, updatedAt: now })
          .where(eq(listings.id, row.id));
        failed++;
        logError(
          "Verify",
          `could not verify ${row.id}: ${result.error ?? "empty item page"}`,
        );
        continue;
      }

      const updates: Partial<typeof listings.$inferInsert> = {
        status: "missing",
        lastVerifiedAt: now,
        updatedAt: now,
      };
      let priceChanged = false;
      const price =
        result.price != null && Number.isFinite(result.price)
          ? Math.floor(result.price)
          : null;

      if (result.name && result.name.trim() && result.name !== row.name) {
        updates.name = result.name.trim();
      }
      if (price != null && price !== row.lastPrice) {
        updates.prevPrice = row.lastPrice;
        updates.lastPrice = price;
        updates.priceChangedAt = now;
        priceChanged = true;
      }
      if (result.image && result.image !== row.imageUrl) {
        updates.imageUrl = result.image;
      }
      if (result.details) {
        updates.details = result.details as unknown as Record<string, unknown>;
        updates.detailsScrapedAt = now;
        if (!result.image && result.details.images?.[0] && !row.imageUrl) {
          updates.imageUrl = result.details.images[0];
        }
      }

      await db.update(listings).set(updates).where(eq(listings.id, row.id));

      if (priceChanged && price != null) {
        const data = {
          ...((result.details ?? {}) as Record<string, unknown>),
          source: "verification",
        };
        await db.insert(listingSightings).values({
          listingId: row.id,
          scrapeRunId,
          searchRoutineId: routineByListing.get(row.id) ?? null,
          observedAt: now,
          price,
          data,
        });
        await db.insert(listingEvents).values({
          listingId: row.id,
          scrapeRunId,
          searchRoutineId: routineByListing.get(row.id) ?? null,
          kind: "price_change",
          oldPrice: row.lastPrice,
          newPrice: price,
          // The item is no longer in the routine results — history only.
          notified: true,
          createdAt: now,
        });
      }

      exists++;
      log(
        "Verify",
        `still exists ${row.id} (${row.engineSlug})${priceChanged ? ` · price ${row.lastPrice} → ${price}` : ""}`,
      );
    } catch (err) {
      failed++;
      logError("Verify", `${row.id}: ${err}`);
    }
  }

  const complete = failed === 0;
  await db.insert(scrapeRoutineResults).values({
    scrapeRunId,
    searchRoutineId: null,
    engineSlug: ITEM_VERIFICATION_JOB_SLUG,
    complete,
    pagesPlanned: planned,
    pagesFetched: exists,
    pagesFailed: failed,
    itemsSeen: exists + deleted,
    error: failed > 0 ? `${failed}/${planned} item verifications failed` : null,
  });

  log(
    "Verify",
    `verification done planned=${planned} exists=${exists} deleted=${deleted} failed=${failed}`,
  );

  return {
    planned,
    exists,
    deleted,
    failed,
    complete,
    skipped: false,
  };
}
