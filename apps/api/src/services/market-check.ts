import {
  and,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
} from "drizzle-orm";
import {
  listings,
  marketPrices,
  scrapeRoutineResults,
  type Database,
} from "@watcher/db";
import { MARKET_CHECK_JOB_SLUG } from "@watcher/shared";
import { log, logError } from "../lib/time";
import {
  MarketCheckError,
  recordMarketCheckFailure,
  refreshMarketCheck,
} from "./deals";

/** Market lookups are slow (browser + AI); keep the per-run batch small. */
const MARKET_CHECK_BATCH = 5;
/** A cached shop price is refreshed after this many days. */
const MARKET_MAX_AGE_DAYS = 7;
/** Árukereső does not sell property or cars. */
const SKIP_ENGINES = ["ingatlan.com", "hasznaltauto.hu"];

export interface MarketCheckJobResult {
  planned: number;
  checked: number;
  noMatch: number;
  failed: number;
  complete: boolean;
  skipped: boolean;
}

export type MarketCheckProgressFn = (info: {
  index: number;
  total: number;
  listingId: string;
  engineSlug: string;
  name: string;
}) => void;

/**
 * Scrape-run job: refresh Árukereső shop prices for listings whose cached
 * quote is missing or older than MARKET_MAX_AGE_DAYS. Expected "no match"
 * outcomes are recorded so the same listing is not retried every run.
 */
export async function runMarketCheckJob(
  db: Database,
  scrapeRunId: number,
  onProgress?: MarketCheckProgressFn,
): Promise<MarketCheckJobResult> {
  const cutoff = new Date(
    Date.now() - MARKET_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
  );

  const rows = await db
    .select({ listing: listings })
    .from(listings)
    .leftJoin(marketPrices, eq(marketPrices.listingId, listings.id))
    .where(
      and(
        eq(listings.status, "active"),
        eq(listings.notInterested, false),
        isNotNull(listings.lastPrice),
        gt(listings.lastPrice, 0),
        notInArray(listings.engineSlug, SKIP_ENGINES),
        or(
          isNull(marketPrices.listingId),
          isNull(marketPrices.lastCheckedAt),
          lt(marketPrices.lastCheckedAt, cutoff),
        ),
      ),
    )
    .orderBy(desc(listings.firstSeenAt))
    .limit(MARKET_CHECK_BATCH);

  const pending = rows
    .map((row) => row.listing)
    .filter((row) => !row.url.includes("ingatlan.jofogas.hu"));

  const planned = pending.length;
  if (planned === 0) {
    log("Market", "no listings pending market check");
    return {
      planned: 0,
      checked: 0,
      noMatch: 0,
      failed: 0,
      complete: true,
      skipped: true,
    };
  }

  log("Market", `market-check job: ${planned} listing(s) pending`);

  let checked = 0;
  let noMatch = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i++) {
    const row = pending[i]!;
    onProgress?.({
      index: i + 1,
      total: planned,
      listingId: row.id,
      engineSlug: row.engineSlug,
      name: row.name,
    });

    try {
      const market = await refreshMarketCheck(db, row);
      checked++;
      log(
        "Market",
        `ok ${row.id}: shop=${market.shopPrice} resell=${market.resellPrice}`,
      );
    } catch (err) {
      if (err instanceof MarketCheckError) {
        noMatch++;
        try {
          await recordMarketCheckFailure(db, row, err.message);
        } catch (recordErr) {
          failed++;
          logError("Market", `could not record no-match for ${row.id}: ${recordErr}`);
        }
        log("Market", `no match ${row.id}: ${err.message}`);
      } else {
        failed++;
        logError("Market", `fail ${row.id}: ${err}`);
      }
    }
  }

  const complete = failed === 0;
  await db.insert(scrapeRoutineResults).values({
    scrapeRunId,
    searchRoutineId: null,
    engineSlug: MARKET_CHECK_JOB_SLUG,
    complete,
    pagesPlanned: planned,
    pagesFetched: checked,
    pagesFailed: failed,
    itemsSeen: checked + noMatch,
    error: failed > 0 ? `${failed}/${planned} market checks failed` : null,
  });

  log(
    "Market",
    `market-check done planned=${planned} ok=${checked} noMatch=${noMatch} failed=${failed}`,
  );

  return {
    planned,
    checked,
    noMatch,
    failed,
    complete,
    skipped: false,
  };
}
