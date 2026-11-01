import type { Page } from "playwright";
import type { ShopPriceOffer, ShopPriceResult } from "@watcher/shared";
import { gotoSmart } from "./browser";
import { dismissConsent } from "./lib/consent";
import { humanDelay, parsePriceHu } from "./lib/util";
import { log } from "./lib/log";

const ARUKERESO_BASE = "https://www.arukereso.hu";
const SEARCH_PATH = "/CategorySearch.php";
const PAGE_SIZE = 20;
/** Search pages to inspect before giving up on a strong match. */
const MAX_SEARCH_PAGES = 2;
/** Minimum textual overlap for a candidate to be considered a match. */
const MIN_MATCH_SCORE = 0.3;

const STOP_WORDS = new Set([
  "elado",
  "eladó",
  "hasznalt",
  "használt",
  "uj",
  "új",
  "ujszeru",
  "újszerű",
  "jo",
  "jó",
  "szep",
  "szép",
  "allapot",
  "állapot",
  "allapotu",
  "állapotú",
  "hibatlan",
  "hibás",
  "hibas",
  "garancia",
  "garanciális",
  "garancialis",
  "ar",
  "ár",
  "ft",
  "huf",
  "ezer",
  "ingyen",
  "akcio",
  "akció",
  "sale",
  "new",
  "used",
  "like",
  "top",
  "the",
  "for",
  "with",
  "and",
  "original",
  "gyari",
  "gyári",
  "komplett",
  "dobozos",
  "doboz",
  "csomag",
  "darab",
  "db",
  "es",
  "és",
  "az",
  "egy",
  "budapest",
  "magyarorszag",
  "magyarország",
  "hirdetes",
  "hirdetés",
  "kiado",
  "kiadó",
  "keres",
  "kinal",
  "kínál",
  "leiras",
  "leírás",
  "marka",
  "márka",
  "tipus",
  "típus",
  "surgos",
  "sürgős",
  "olcso",
  "olcsó",
  "megkimelt",
  "megkímélt",
  "kifogastalan",
  "kifogástalan",
  "hasznalatlan",
  "használatlan",
  "szinte",
  "nagyon",
  "csak",
  "elviheto",
  "elvihető",
  "alkudozas",
  "alkudozás",
  "iranyar",
  "irányár",
  "megegyezes",
  "megegyezés",
  "esetleg",
]);

/** Accessory words that should not make a product match if the query lacks them. */
const ACCESSORY_WORDS = new Set([
  "tok",
  "tartó",
  "tarto",
  "tartozek",
  "tartozék",
  "kabel",
  "kábel",
  "tolto",
  "töltő",
  "vedofolia",
  "védőfólia",
  "folia",
  "fólia",
  "kijelzo",
  "kijelző",
  "hatlap",
  "hátlap",
  "uveg",
  "üveg",
  "taska",
  "táska",
  "kiegészítő",
  "kiegeszito",
  "alkatresz",
  "alkatrész",
  "markolat",
  "tripod",
  "allvany",
  "állvány",
  "fulparna",
  "fulparnak",
  "fülpárna",
  "fülpárnák",
  "parna",
  "párna",
  "memoriahab",
  "memóriahab",
  "csere",
  "adapter",
  "konverter",
  "vedo",
  "védő",
  "burkolat",
  "fedlap",
  "fedél",
  "fedolap",
  "fedőlap",
  "elolap",
  "előlap",
  "uveglap",
  "üveglap",
  "keret",
  "frame",
  "akku",
  "akkumulator",
  "akkumulátor",
  "battery",
  "helyettesito",
  "helyettesítő",
  "kompatibilis",
  "potlo",
  "pótló",
  "szuro",
  "szűrő",
  "zsak",
  "zsák",
  "stylus",
  "ceruza",
  "szalagkabel",
  "szalagkábel",
  "atvezeto",
  "átvezető",
  "flex",
  "signal",
]);

function normalizeWord(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

/** True when a token looks like an accessory/part word (handles compounds). */
function isAccessoryToken(token: string): boolean {
  for (const raw of ACCESSORY_WORDS) {
    const word = normalizeWord(raw);
    if (!word) continue;
    if (token === word) return true;
    if (word.length >= 4 && token.includes(word)) return true;
    if (token.length >= 4 && word.includes(token)) return true;
    if (token.startsWith(word) && token.length <= word.length + 4) return true;
  }
  return false;
}

/** Árukereső category segments that indicate an accessory, not the product. */
const ACCESSORY_URL_RE =
  /-(?:tok|tartozek|kabel|adapter|alkatresz|vedofolia|hatlap|kijelzo|tolt[o]?|fulparna|taska|allvany|markolat|stylus|ceruza|akkumulator|fedolap|szalagkabel|atvezeto|helyettesito)-c\d+/i;

interface RawCandidate {
  name: string;
  priceText: string;
  url: string;
  image: string | null;
}

interface RawOffer {
  priceText: string;
  store: string | null;
  name: string | null;
}

interface RankedCandidate {
  candidate: RawCandidate;
  price: number;
  score: number;
  confidence: "model" | "similar";
  matchedTokens: string[];
}

export function buildArukeresoSearchUrl(query: string, page = 0): string {
  const params = new URLSearchParams({ st: query.trim() });
  if (page > 0) params.set("start", String(page * PAGE_SIZE));
  return `${ARUKERESO_BASE}${SEARCH_PATH}?${params.toString()}`;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/** Model/variant words that should stay attached to the product name. */
const VARIANT_WORDS = new Set([
  "pro",
  "max",
  "plus",
  "mini",
  "ultra",
  "lite",
  "se",
  "fe",
  "fold",
  "flip",
  "note",
  "air",
  "touch",
  "series",
  "gt",
  "ti",
  "super",
  "mark",
  "mk",
  "ii",
  "iii",
  "iv",
]);

/**
 * Shorter fallback query: keep everything through the last model token plus a
 * trailing variant word ("Samsung Galaxy S22 Ultra"), dropping marketing noise
 * that often follows the model in marketplace titles.
 */
function compactQuery(tokens: string[]): string {
  let lastModel = -1;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (isModelToken(token) && !isPartNumberToken(token)) lastModel = i;
  }
  if (lastModel < 0) return tokens.slice(0, 6).join(" ");

  let end = lastModel;
  for (let i = lastModel + 1; i < tokens.length; i++) {
    if (VARIANT_WORDS.has(tokens[i]!)) end = i;
    else break;
  }
  return tokens.slice(0, end + 1).join(" ");
}

/**
 * Broad category fallback ("bosch kezi korfuresz") for listings whose exact
 * model is not sold on Árukereső. Used only when the model queries fail.
 */
function productTypeQuery(tokens: string[]): string {
  if (tokens.length < 2) return "";
  const brand = tokens[0]!;
  const typeTokens = tokens
    .slice(1)
    .filter((t) => !isModelToken(t) && !isAccessoryToken(t))
    .slice(-2);
  if (typeTokens.length === 0) return "";
  return [brand, ...typeTokens].join(" ");
}

function buildQueryVariants(query: string, tokens: string[]): string[] {
  // If the query itself ends in an accessory word ("iPhone 13 tok"), keep the
  // full title; the compact form would drop the thing being priced. Battery
  // adjectives inside tool titles ("akkumulátoros fúrógép") must NOT trigger
  // this, otherwise compact fallback never runs for those listings.
  const last = tokens[tokens.length - 1];
  if (last && isAccessoryToken(last)) return [query];

  const compact = compactQuery(tokens);
  const typeQuery = productTypeQuery(tokens);
  const variants: string[] = [];
  if (compact) variants.push(compact);
  if (compact && compact.toLowerCase() !== query.toLowerCase()) {
    variants.push(query);
  } else if (!compact) {
    variants.push(query);
  }
  if (typeQuery && typeQuery.toLowerCase() !== compact.toLowerCase()) {
    variants.push(typeQuery);
  }
  return [...new Set(variants)];
}

function isModelToken(token: string): boolean {
  return /\d/.test(token) && token.length >= 2;
}

/** Long alphanumeric strings are usually part numbers, not model names. */
function isPartNumberToken(token: string): boolean {
  return token.length >= 8 && /\d/.test(token);
}

/**
 * Model tokens are often variants of each other:
 * "1000xm4" vs "1000xm4c", "wh1000xm4cb", "128gb" vs "128".
 * Accept short prefix/suffix differences but not entirely different models.
 */
function modelTokensMatch(queryToken: string, candidateToken: string): boolean {
  if (queryToken === candidateToken) return true;
  if (
    candidateToken.startsWith(queryToken) ||
    queryToken.startsWith(candidateToken)
  ) {
    return Math.abs(candidateToken.length - queryToken.length) <= 3;
  }
  if (
    candidateToken.includes(queryToken) ||
    queryToken.includes(candidateToken)
  ) {
    return Math.min(candidateToken.length, queryToken.length) >= 3;
  }
  return false;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function rankCandidate(
  queryTokens: string[],
  queryTokenSet: Set<string>,
  candidate: RawCandidate,
  price: number,
): RankedCandidate | null {
  const candidateTokens = tokenize(candidate.name);
  const candidateSet = new Set(candidateTokens);
  const modelQuery = queryTokens.filter(isModelToken);
  const modelCandidate = candidateTokens.filter(isModelToken);
  const modelOverlap = modelQuery.filter((t) =>
    modelCandidate.some((candidateToken) => modelTokensMatch(t, candidateToken)),
  );

  // A product with a different model number is almost never the same item.
  if (modelQuery.length > 0 && modelOverlap.length === 0) return null;

  const overlap = queryTokens.filter(
    (t) =>
      candidateSet.has(t) ||
      (isModelToken(t) &&
        modelCandidate.some((candidateToken) => modelTokensMatch(t, candidateToken))),
  );
  if (overlap.length === 0) return null;

  const missingModel = modelQuery.filter(
    (t) =>
      !modelCandidate.some((candidateToken) => modelTokensMatch(t, candidateToken)),
  );
  const extraModel = modelCandidate.filter(
    (candidateToken) =>
      !modelQuery.some((t) => modelTokensMatch(t, candidateToken)),
  );
  const accessory = candidateTokens.filter(
    (t) => isAccessoryToken(t) && !queryTokenSet.has(t),
  );
  const accessoryUrl =
    candidate.url &&
    ACCESSORY_URL_RE.test(candidate.url) &&
    ![...queryTokenSet].some((t) => ACCESSORY_WORDS.has(t));

  // Accessories (cases, cables, ear pads, …) are not the product being priced —
  // unless the query itself is looking for an accessory (usually the last noun,
  // e.g. "iPhone 13 tok"). Battery adjectives in tool titles are ignored here.
  const queryLast = queryTokens[queryTokens.length - 1];
  const queryWantsAccessory = queryLast != null && isAccessoryToken(queryLast);
  if (!queryWantsAccessory && (accessoryUrl || accessory.length > 0)) return null;

  const base = overlap.length / Math.max(queryTokens.length, 1);
  const modelScore =
    modelQuery.length > 0 ? modelOverlap.length / modelQuery.length : 0;
  const score =
    base + 0.35 * modelScore - 0.3 * missingModel.length - 0.2 * extraModel.length;

  if (score < MIN_MATCH_SCORE || price <= 0) return null;

  const confidence: "model" | "similar" =
    modelQuery.length > 0 && missingModel.length === 0 && extraModel.length <= 1
      ? "model"
      : "similar";

  return {
    candidate,
    price,
    score,
    confidence,
    matchedTokens: overlap.slice(0, 6),
  };
}

async function extractCandidates(page: Page): Promise<RawCandidate[]> {
  return page.evaluate(() => {
    const clean = (value: string | null | undefined): string =>
      (value || "").replace(/\s+/g, " ").trim();

    const out: Array<{
      name: string;
      priceText: string;
      url: string;
      image: string | null;
    }> = [];
    const seen = new Set<string>();

    for (const box of Array.from(document.querySelectorAll(".product-box"))) {
      const root = box as HTMLElement;
      const name = clean(
        root.querySelector(".name h2 a, .name a, h2 a")?.textContent,
      );
      const priceText = clean(
        root.querySelector(".top-right a.price, .visible-xs .price, .price")
          ?.textContent,
      );
      if (!name || !priceText) continue;

      let url = "";
      const info = root.querySelector("a.ak-info[href]") as HTMLAnchorElement | null;
      if (info?.href && !/Jump\.php/i.test(info.href)) url = info.href;
      if (!url) {
        for (const a of Array.from(
          root.querySelectorAll<HTMLAnchorElement>("a[href]"),
        )) {
          if (/Jump\.php/i.test(a.href)) continue;
          if (/-p\d+\/?$/i.test(a.pathname) || /-p\d+\//i.test(a.pathname)) {
            url = a.href;
            break;
          }
        }
      }

      const img = root.querySelector("img") as HTMLImageElement | null;
      const image =
        img?.src ||
        img?.getAttribute("data-src") ||
        img?.getAttribute("data-lazy-src") ||
        null;

      const key = `${name}|${priceText}|${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name,
        priceText,
        url,
        image: image && !image.startsWith("data:") ? image : null,
      });
    }

    return out;
  });
}

async function extractOffers(page: Page): Promise<RawOffer[]> {
  return page.evaluate(() => {
    const clean = (value: string | null | undefined): string =>
      (value || "").replace(/\s+/g, " ").trim();

    const out: Array<{ priceText: string; store: string | null; name: string | null }> = [];
    const seen = new Set<string>();

    const push = (priceText: string, store: string | null, name: string | null) => {
      if (!priceText) return;
      const key = `${priceText}|${store || ""}|${name || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ priceText, store: store || null, name: name || null });
    };

    for (const el of Array.from(
      document.querySelectorAll("#offer-list .optoffer, .optoffer"),
    )) {
      const priceEl = el.querySelector("[itemprop='price']") as HTMLElement | null;
      const priceText =
        priceEl?.getAttribute("content") || clean(priceEl?.textContent);
      const store = clean(
        el.querySelector(
          "[itemprop='seller'] [itemprop='name'], .shopname [itemprop='name'], .shopname",
        )?.textContent,
      );
      const name = clean(
        el.querySelector(".offer-name h4, .offer-name")?.textContent,
      );
      push(priceText, store, name);
    }

    // Product pages occasionally render only JSON-LD offers.
    if (out.length === 0) {
      for (const script of Array.from(
        document.querySelectorAll('script[type="application/ld+json"]'),
      )) {
        try {
          const data = JSON.parse(script.textContent || "null") as unknown;
          const stack: unknown[] = Array.isArray(data) ? [...data] : [data];
          while (stack.length) {
            const node = stack.shift();
            if (!node || typeof node !== "object") continue;
            const obj = node as Record<string, unknown>;
            const type = obj["@type"];
            const isOffer =
              type === "Offer" ||
              (Array.isArray(type) && type.includes("Offer"));
            if (isOffer) {
              const price =
                typeof obj.price === "number" ? String(obj.price) : obj.price;
              const seller = obj.seller;
              const sellerName =
                seller && typeof seller === "object"
                  ? (seller as Record<string, unknown>).name
                  : null;
              if (typeof price === "string" && price.trim()) {
                push(
                  price,
                  typeof sellerName === "string" ? sellerName : null,
                  null,
                );
              }
            }
            for (const key of ["@graph", "offers", "itemListElement"]) {
              const value = obj[key];
              if (Array.isArray(value)) stack.push(...value);
              else if (value && typeof value === "object") stack.push(value);
            }
          }
        } catch {
          /* ignore malformed JSON-LD */
        }
      }
    }

    return out;
  });
}

function toOffer(
  raw: RawOffer,
  fallbackUrl: string | null,
): ShopPriceOffer | null {
  const price = parsePriceHu(raw.priceText);
  if (price == null || price <= 0) return null;
  return {
    store: raw.store,
    price,
    name: raw.name,
    url: fallbackUrl,
  };
}

async function searchCandidates(
  page: Page,
  query: string,
  maxPages: number,
  queryTokens: string[],
  queryTokenSet: Set<string>,
): Promise<{ candidates: RawCandidate[]; searchUrl: string; pages: number }> {
  const all: RawCandidate[] = [];
  const seen = new Set<string>();
  let searchUrl = buildArukeresoSearchUrl(query, 0);
  let pages = 0;

  for (let p = 0; p < maxPages; p++) {
    const url = buildArukeresoSearchUrl(query, p);
    searchUrl = url;
    await gotoSmart(page, url);
    await dismissConsent(page);

    try {
      await page.waitForSelector(".product-box, .product-box-container", {
        timeout: 12_000,
      });
    } catch {
      log("arukereso", `no product boxes on search page ${p + 1}`);
    }

    const pageCandidates = await extractCandidates(page);
    pages++;
    log("arukereso", `search page ${p + 1}: ${pageCandidates.length} candidates`);

    for (const candidate of pageCandidates) {
      const key = `${candidate.name}|${candidate.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(candidate);
    }

    // Signals that no further result pages are useful.
    if (pageCandidates.length === 0) break;

    // A strong match on this page is enough; skip extra result pages.
    const strongMatch = pageCandidates.some((candidate) => {
      const price = parsePriceHu(candidate.priceText);
      if (price == null) return false;
      const ranked = rankCandidate(queryTokens, queryTokenSet, candidate, price);
      return ranked != null && ranked.score >= 0.5;
    });
    if (strongMatch) {
      log("arukereso", `strong match on page ${p + 1}, stopping search`);
      break;
    }

    if (p + 1 < maxPages) await humanDelay(700, 1600);
  }

  return { candidates: all, searchUrl, pages };
}

/**
 * Look up a product on Árukereső and estimate its current shop price.
 *
 * Search results are ranked against the query (model numbers weigh heavily),
 * then the best matching product page is opened to collect per-shop offers.
 * The median offer becomes the shop-price estimate.
 */
export async function lookupShopPrice(
  page: Page,
  query: string,
): Promise<ShopPriceResult> {
  const started = Date.now();
  const cleanedQuery = query.replace(/\s+/g, " ").trim().slice(0, 160);
  const empty = (error: string, url = ""): ShopPriceResult => ({
    ok: false,
    query: cleanedQuery,
    url,
    price: null,
    lowest: null,
    highest: null,
    sampleSize: 0,
    offers: [],
    productName: null,
    productUrl: null,
    confidence: "similar",
    matchedTokens: [],
    error,
    durationMs: Date.now() - started,
  });

  if (!cleanedQuery) return empty("query required");

  const queryTokens = tokenize(cleanedQuery);
  if (queryTokens.length === 0) {
    return empty("query has no searchable product tokens");
  }

  let candidates: RawCandidate[] = [];
  let searchUrl = "";
  let usedQuery = cleanedQuery;
  let ranked: RankedCandidate[] = [];

  // Full title first; if Árukereső returns nothing (or only accessories), retry
  // with a product-only query — marketplace titles often end with colour,
  // condition or location noise.
  for (const variant of buildQueryVariants(cleanedQuery, queryTokens)) {
    const variantTokens = tokenize(variant);
    const variantSet = new Set(variantTokens);
    const found = await searchCandidates(
      page,
      variant,
      MAX_SEARCH_PAGES,
      variantTokens,
      variantSet,
    );
    searchUrl = found.searchUrl;
    if (found.candidates.length === 0) {
      log("arukereso", `no results for "${variant}", trying a shorter query`);
      await humanDelay(900, 1800);
      continue;
    }

    const rankedForVariant: RankedCandidate[] = [];
    for (const candidate of found.candidates) {
      const price = parsePriceHu(candidate.priceText);
      if (price == null) continue;
      const item = rankCandidate(variantTokens, variantSet, candidate, price);
      if (item) rankedForVariant.push(item);
    }

    if (rankedForVariant.length > 0) {
      candidates = found.candidates;
      ranked = rankedForVariant;
      usedQuery = variant;
      break;
    }
    log("arukereso", `no usable match for "${variant}", trying a shorter query`);
    await humanDelay(900, 1800);
  }

  if (candidates.length === 0) {
    return empty("No products found on arukereso.hu", searchUrl);
  }
  if (ranked.length === 0) {
    return empty("No matching product found on arukereso.hu", searchUrl);
  }

  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0]!;

  let offers: ShopPriceOffer[] = [];
  if (best.candidate.url) {
    try {
      await gotoSmart(page, best.candidate.url);
      await dismissConsent(page);
      try {
        await page.waitForSelector(
          "#offer-list, .optoffer, [itemprop='price']",
          { timeout: 6_000 },
        );
      } catch {
        log("arukereso", "no offer list selector (parsing page anyway)");
      }
      let rawOffers = await extractOffers(page);
      if (rawOffers.length === 0) {
        // Offers are sometimes rendered a moment after the page shell.
        await humanDelay(1200, 2200);
        rawOffers = await extractOffers(page);
      }
      offers = rawOffers
        .map((offer) => toOffer(offer, best.candidate.url))
        .filter((offer): offer is ShopPriceOffer => offer != null);
    } catch (err) {
      log("arukereso", `product page failed: ${err}`);
    }
  }

  // Fall back to the price shown on the search result ("Ft-tól").
  if (offers.length === 0) {
    offers = [
      {
        store: null,
        price: best.price,
        name: best.candidate.name,
        url: best.candidate.url || null,
      },
    ];
  }

  // Ignore absurd offer prices (shipping insurance, accessories bundled weirdly).
  const prices = offers
    .map((offer) => offer.price)
    .filter((price) => price > 0)
    .sort((a, b) => a - b);
  if (prices.length === 0) {
    return empty("No shop offers with a price found", searchUrl);
  }

  const price = median(prices);
  const result: ShopPriceResult = {
    ok: true,
    query: usedQuery,
    url: searchUrl,
    price,
    lowest: prices[0]!,
    highest: prices[prices.length - 1]!,
    sampleSize: prices.length,
    offers: offers.slice(0, 50),
    productName: best.candidate.name,
    productUrl: best.candidate.url || null,
    confidence: best.confidence,
    matchedTokens: best.matchedTokens,
    durationMs: Date.now() - started,
  };

  log(
    "arukereso",
    `match "${best.candidate.name}" price=${price} offers=${prices.length} ` +
      `confidence=${best.confidence} ${result.durationMs}ms`,
  );

  return result;
}
