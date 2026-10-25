import { and, gte, isNotNull, sql } from "drizzle-orm";
import { listingSightings, listings, type Database } from "@watcher/db";
import type { ListingDeal } from "@watcher/shared";

/** How far back comparable listings are considered. */
const MARKET_WINDOW_DAYS = 180;
/** A model-level comparison needs at least this many listings. */
const MIN_MODEL_COMPS = 3;
/** A broader comparison needs a larger sample to be worth showing. */
const MIN_SIMILAR_COMPS = 5;

/** Words that carry no product information. Token forms are normalized. */
const STOP_WORDS = new Set([
  "elado",
  "hasznalt",
  "uj",
  "hibas",
  "jo",
  "szep",
  "allapot",
  "darab",
  "db",
  "es",
  "az",
  "egy",
  "the",
  "for",
  "with",
  "and",
  "original",
  "gyari",
  "komplett",
  "ar",
  "ft",
  "huf",
  "ezer",
  "ingyen",
  "akcio",
  "sale",
  "new",
  "used",
  "like",
  "top",
  "budapest",
  "magyarorszag",
  "hirdetes",
  "kinal",
  "keres",
  "elhelyezkedes",
  "varos",
  "megye",
  "telepules",
  "cim",
  "kerulet",
  "utca",
  "marka",
  "tipus",
  "leiras",
  "description",
  "condition",
  "seller",
  "location",
  "hirdeto",
  "felado",
  "telefon",
  "phone",
  "email",
  "kapcsolat",
  "contact",
  "weboldal",
  "honlap",
  "ugyfel",
  "ugyfelszolgalat",
  "szallitas",
  "garancia",
  "garancia",
]);

/** Attribute keys that identify people/places rather than the product. */
const PERSONAL_ATTRS = new Set([
  "seller",
  "hirdeto",
  "felado",
  "telefon",
  "phone",
  "email",
  "kapcsolat",
  "contact",
  "weboldal",
  "honlap",
  "ugyfel",
  "ugyfelszolgalat",
]);

/** Location attrs are useful for real estate but not for product prices. */
const PLACE_ATTRS = new Set([
  "location",
  "elhelyezkedes",
  "varos",
  "megye",
  "telepules",
  "cim",
  "kerulet",
  "utca",
]);

const REAL_ESTATE_ENGINES = new Set(["ingatlan.com"]);

export interface SightingStat {
  count: number;
  lowest: number | null;
  highest: number | null;
}

type ListingRow = Pick<
  typeof listings.$inferSelect,
  "id" | "name" | "engineSlug" | "lastPrice" | "details"
>;

interface PoolItem {
  row: ListingRow;
  tokens: Set<string>;
  seller: string | null;
  price: number;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenize(value: string): Set<string> {
  const parts = normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));

  const tokens = new Set(parts);
  // Join adjacent words so "GKS 185" also produces "gks185".
  for (let i = 0; i < parts.length - 1; i++) {
    tokens.add(`${parts[i]}${parts[i + 1]}`);
  }
  return tokens;
}

function isModelToken(token: string): boolean {
  return token.length >= 3 && /\d/.test(token);
}

function attributeEntries(
  row: ListingRow,
): Array<[string, unknown]> {
  const details = row.details as { attributes?: Record<string, unknown> } | null;
  const attrs = details?.attributes;
  if (!attrs || typeof attrs !== "object") return [];
  return Object.entries(attrs);
}

function tokensFor(row: ListingRow): Set<string> {
  const tokens = tokenize(row.name);
  const realEstate = REAL_ESTATE_ENGINES.has(row.engineSlug);

  for (const [key, value] of attributeEntries(row)) {
    const k = normalizeText(key).trim();
    if (PERSONAL_ATTRS.has(k)) continue;
    if (!realEstate && PLACE_ATTRS.has(k)) continue;
    if (typeof value !== "string" && typeof value !== "number") continue;
    for (const token of tokenize(String(value).slice(0, 160))) tokens.add(token);
  }
  return tokens;
}

function sellerFor(row: ListingRow): string | null {
  for (const [key, value] of attributeEntries(row)) {
    const k = normalizeText(key).trim();
    if ((k === "seller" || k === "hirdeto" || k === "felado") && typeof value === "string") {
      const seller = normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
      return seller || null;
    }
  }
  return null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
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

/**
 * Price context for the requested listings: all-time low plus a median from
 * same-model or similar listings on the same engine.
 */
export async function computeDeals(
  db: Database,
  targets: ListingRow[],
  stats: Map<string, SightingStat>,
): Promise<Map<string, ListingDeal>> {
  const out = new Map<string, ListingDeal>();
  if (targets.length === 0) return out;

  const cutoff = new Date(Date.now() - MARKET_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: listings.id,
      name: listings.name,
      engineSlug: listings.engineSlug,
      lastPrice: listings.lastPrice,
      details: listings.details,
    })
    .from(listings)
    .where(and(isNotNull(listings.lastPrice), gte(listings.lastSeenAt, cutoff)));

  const pool: PoolItem[] = rows
    .filter((row) => (row.lastPrice ?? 0) > 0)
    .map((row) => ({
      row,
      tokens: tokensFor(row),
      seller: sellerFor(row),
      price: row.lastPrice!,
    }));

  const index = new Map<string, number[]>();
  for (let i = 0; i < pool.length; i++) {
    for (const token of pool[i]!.tokens) {
      const list = index.get(token);
      if (list) list.push(i);
      else index.set(token, [i]);
    }
  }
  const poolById = new Map(pool.map((item, i) => [item.row.id, i]));

  for (const target of targets) {
    const stat = stats.get(target.id);
    const price = target.lastPrice;
    const observations = stat?.count ?? 0;
    const lowest = stat?.lowest ?? null;
    const highest = stat?.highest ?? null;

    const deal: ListingDeal = {
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

    const targetIndex = poolById.get(target.id);
    if (targetIndex == null || price == null || price <= 0) {
      out.set(target.id, deal);
      continue;
    }

    const targetItem = pool[targetIndex]!;
    const broadCounts = new Map<number, number>();
    const modelMatches = new Set<number>();

    for (const token of targetItem.tokens) {
      const posting = index.get(token);
      if (!posting) continue;
      const model = isModelToken(token);

      for (const i of posting) {
        if (i === targetIndex) continue;
        const comp = pool[i]!;
        if (comp.row.engineSlug !== target.engineSlug) continue;
        if (
          targetItem.seller &&
          comp.seller &&
          targetItem.seller === comp.seller
        ) {
          continue;
        }
        broadCounts.set(i, (broadCounts.get(i) ?? 0) + 1);
        if (model) modelMatches.add(i);
      }
    }

    const modelIds = [...modelMatches];
    const similarIds = [...broadCounts.entries()]
      .filter(([, shared]) => shared >= 2)
      .map(([i]) => i);

    let chosen: number[] = [];
    let confidence: "model" | "similar" = "similar";
    if (modelIds.length >= MIN_MODEL_COMPS) {
      chosen = modelIds;
      confidence = "model";
    } else if (similarIds.length >= MIN_SIMILAR_COMPS) {
      chosen = similarIds;
      confidence = "similar";
    }
    if (chosen.length === 0) {
      out.set(target.id, deal);
      continue;
    }

    const prices = chosen
      .map((i) => pool[i]!.price)
      .filter((p) => p > 0);
    if (prices.length < (confidence === "model" ? MIN_MODEL_COMPS : MIN_SIMILAR_COMPS)) {
      out.set(target.id, deal);
      continue;
    }

    const med = median(prices);
    if (med <= 0) {
      out.set(target.id, deal);
      continue;
    }

    const tokenCounts = new Map<string, number>();
    for (const token of targetItem.tokens) {
      let n = 0;
      for (const i of chosen) if (pool[i]!.tokens.has(token)) n++;
      if (n > 0) tokenCounts.set(token, n);
    }
    const matchedTokens = [...tokenCounts.entries()]
      .filter(([, n]) => n >= Math.ceil(chosen.length * 0.25))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([token]) => token);

    deal.market = {
      medianPrice: med,
      sampleSize: prices.length,
      deltaPct: Math.round(((price - med) / med) * 100),
      confidence,
      matchedTokens,
    };
    out.set(target.id, deal);
  }

  return out;
}
