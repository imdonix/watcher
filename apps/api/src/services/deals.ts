import { eq, inArray, sql } from "drizzle-orm";
import {
  listingSightings,
  listings,
  marketPrices,
  type Database,
} from "@watcher/db";
import type { DealMarket, ListingDeal } from "@watcher/shared";
import { log, logError } from "../lib/time";
import { extractProductQuery, loadAiConfig } from "./ai";
import { runShopPrice } from "./scraper-client";

/** Attribute keys that help Árukereső find the exact product. */
const PRODUCT_ATTR_KEYS = new Set([
  "marka",
  "brand",
  "gyarto",
  "gyartmany",
  "manufacturer",
  "modell",
  "model",
  "tipus",
  "type",
  "szeria",
  "series",
  "meret",
  "kapacitas",
  "capacity",
  "tarhely",
  "storage",
]);

export interface SightingStat {
  count: number;
  lowest: number | null;
  highest: number | null;
}

type ListingRow = Pick<
  typeof listings.$inferSelect,
  "id" | "name" | "lastPrice" | "details" | "engineSlug" | "url"
>;

type MarketQuote = Pick<
  typeof marketPrices.$inferSelect,
  | "shopPrice"
  | "shopPriceLow"
  | "shopPriceHigh"
  | "sampleSize"
  | "confidence"
  | "matchedTokens"
  | "productName"
  | "productUrl"
  | "fetchedAt"
>;

interface QuoteLike extends Partial<Omit<MarketQuote, "fetchedAt">> {
  shopPrice: number;
  fetchedAt?: Date | string | null;
}

/** Expected "no shop price" outcome — not an HTTP/server failure. */
export class MarketCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketCheckError";
  }
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Observation count + lowest/highest price per listing. */
export async function loadSightingStats(
  db: Database,
): Promise<Map<string, SightingStat>> {
  const rows = await db
    .select({
      listingId: listingSightings.listingId,
      count: sql<number>`count(*)::int`,
      lowest: sql<number | null>`min(${listingSightings.price})::int`,
      highest: sql<number | null>`max(${listingSightings.price})::int`,
    })
    .from(listingSightings)
    .groupBy(listingSightings.listingId);

  return new Map(
    rows.map((row) => [
      row.listingId,
      { count: row.count, lowest: row.lowest, highest: row.highest },
    ]),
  );
}

/** Observation count + lowest/highest price for one listing. */
export async function loadSightingStatFor(
  db: Database,
  listingId: string,
): Promise<SightingStat> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      lowest: sql<number | null>`min(${listingSightings.price})::int`,
      highest: sql<number | null>`max(${listingSightings.price})::int`,
    })
    .from(listingSightings)
    .where(eq(listingSightings.listingId, listingId));

  return {
    count: row?.count ?? 0,
    lowest: row?.lowest ?? null,
    highest: row?.highest ?? null,
  };
}

/**
 * Build the product query used for the Árukereső lookup. The listing title is
 * the primary source; brand/model attributes are appended when they add detail
 * (e.g. "iPhone 13 128GB" + "Apple").
 */
export function buildMarketQuery(row: ListingRow): string {
  const details = row.details as { attributes?: Record<string, unknown> } | null;
  const attrs = details?.attributes ?? {};

  const nameNorm = normalizeText(row.name);
  const additions: string[] = [];

  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const keyNorm = normalizeText(key).replace(/[^a-z0-9]+/g, "");
    if (!PRODUCT_ATTR_KEYS.has(keyNorm)) continue;
    const text = String(value).replace(/\s+/g, " ").trim();
    if (!text || text.length > 60) continue;
    const textNorm = normalizeText(text);
    if (nameNorm.includes(textNorm)) continue;
    if (additions.some((a) => normalizeText(a) === textNorm)) continue;
    additions.push(text);
  }

  return [row.name, ...additions]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function marketFromQuote(resellPrice: number, quote: QuoteLike): DealMarket {
  const shopPrice = Math.max(1, Math.round(quote.shopPrice));
  const low = Math.max(1, Math.round(quote.shopPriceLow ?? shopPrice));
  const high = Math.max(low, Math.round(quote.shopPriceHigh ?? shopPrice));

  return {
    shopPrice,
    shopPriceLow: Math.min(low, shopPrice),
    shopPriceHigh: Math.max(high, shopPrice),
    resellPrice,
    sampleSize: quote.sampleSize ?? 0,
    deltaPct: Math.round(((resellPrice - shopPrice) / shopPrice) * 100),
    savings: shopPrice - resellPrice,
    confidence: quote.confidence === "model" ? "model" : "similar",
    matchedTokens: Array.isArray(quote.matchedTokens) ? quote.matchedTokens : [],
    productName: quote.productName ?? null,
    productUrl: quote.productUrl ?? null,
    source: "arukereso",
    fetchedAt: quote.fetchedAt ? new Date(quote.fetchedAt).toISOString() : null,
  };
}

function emptyDeal(
  target: ListingRow,
  stat: SightingStat | undefined,
): ListingDeal {
  const price = target.lastPrice;
  const observations = stat?.count ?? 0;
  const lowest = stat?.lowest ?? null;
  const highest = stat?.highest ?? null;

  return {
    market: null,
    allTimeLow:
      price != null &&
      lowest != null &&
      highest != null &&
      observations >= 2 &&
      highest > lowest &&
      price <= lowest,
    lowestPrice: lowest,
    highestPrice: highest,
    observations,
  };
}

/**
 * Price context for the requested listings: all-time low plus the cached
 * Árukereső shop-price comparison. Cached rows only — live lookups happen via
 * `refreshMarketCheck` so list/detail requests stay fast.
 */
export async function computeDeals(
  db: Database,
  targets: ListingRow[],
  stats: Map<string, SightingStat>,
): Promise<Map<string, ListingDeal>> {
  const out = new Map<string, ListingDeal>();
  if (targets.length === 0) return out;

  const ids = [...new Set(targets.map((target) => target.id))];
  const rows = await db
    .select()
    .from(marketPrices)
    .where(inArray(marketPrices.listingId, ids));
  const quotes = new Map(rows.map((row) => [row.listingId, row]));

  for (const target of targets) {
    const deal = emptyDeal(target, stats.get(target.id));
    const quote = quotes.get(target.id);
    if (quote && quote.shopPrice > 0 && target.lastPrice != null && target.lastPrice > 0) {
      deal.market = marketFromQuote(target.lastPrice, quote);
    }
    out.set(target.id, deal);
  }

  return out;
}

/**
 * Run a fresh Árukereső shop-price lookup for one listing, persist it and
 * return the resulting market comparison.
 */
export async function refreshMarketCheck(
  db: Database,
  target: ListingRow,
): Promise<DealMarket> {
  if (target.lastPrice == null || target.lastPrice <= 0) {
    throw new Error("Listing has no price to compare");
  }

  const heuristicQuery = buildMarketQuery(target);
  let query = heuristicQuery;

  // Prefer a clean product name from the configured AI model. Marketplace
  // titles are full of condition/location noise that hurts Árukereső search.
  try {
    const cfg = await loadAiConfig(db);
    const aiQuery = await extractProductQuery(cfg, target);
    if (aiQuery) {
      query = aiQuery;
      log("Market", `AI query for ${target.id}: "${query}"`);
    }
  } catch (err) {
    logError("Market", `AI product query failed for ${target.id}: ${err}`);
  }

  const result = await runShopPrice({ query });

  if (!result.ok || result.price == null || !Number.isFinite(result.price)) {
    throw new MarketCheckError(
      result.error || "No shop price found on arukereso.hu",
    );
  }

  const fetchedAt = new Date();
  const values = {
    listingId: target.id,
    query: result.query || query,
    shopPrice: Math.round(result.price),
    shopPriceLow:
      result.lowest != null && Number.isFinite(result.lowest)
        ? Math.round(result.lowest)
        : null,
    shopPriceHigh:
      result.highest != null && Number.isFinite(result.highest)
        ? Math.round(result.highest)
        : null,
    sampleSize: result.sampleSize,
    confidence: result.confidence,
    matchedTokens: result.matchedTokens,
    productName: result.productName,
    productUrl: result.productUrl,
    offers: result.offers as unknown as Array<Record<string, unknown>>,
    error: null,
    lastCheckedAt: fetchedAt,
    fetchedAt,
  };

  await db
    .insert(marketPrices)
    .values(values)
    .onConflictDoUpdate({
      target: marketPrices.listingId,
      set: {
        query: values.query,
        shopPrice: values.shopPrice,
        shopPriceLow: values.shopPriceLow,
        shopPriceHigh: values.shopPriceHigh,
        sampleSize: values.sampleSize,
        confidence: values.confidence,
        matchedTokens: values.matchedTokens,
        productName: values.productName,
        productUrl: values.productUrl,
        offers: values.offers,
        error: null,
        lastCheckedAt: values.lastCheckedAt,
        fetchedAt: values.fetchedAt,
      },
    });

  return marketFromQuote(target.lastPrice, values);
}

/**
 * Record an expected no-match so the scrape job does not retry the same
 * listing every run. Keeps the last successful price when one exists.
 */
export async function recordMarketCheckFailure(
  db: Database,
  target: ListingRow,
  message: string,
): Promise<void> {
  const now = new Date();
  const error = message.replace(/\s+/g, " ").trim().slice(0, 500);
  const [existing] = await db
    .select({ listingId: marketPrices.listingId })
    .from(marketPrices)
    .where(eq(marketPrices.listingId, target.id))
    .limit(1);

  if (existing) {
    await db
      .update(marketPrices)
      .set({ error, lastCheckedAt: now })
      .where(eq(marketPrices.listingId, target.id));
    return;
  }

  await db.insert(marketPrices).values({
    listingId: target.id,
    query: buildMarketQuery(target),
    shopPrice: 0,
    shopPriceLow: null,
    shopPriceHigh: null,
    sampleSize: 0,
    confidence: "similar",
    matchedTokens: [],
    productName: null,
    productUrl: null,
    offers: [],
    error,
    lastCheckedAt: now,
    fetchedAt: now,
  });
}
