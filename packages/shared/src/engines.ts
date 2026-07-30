import { engineId } from "./crypto";
import type { EngineMeta } from "./types";

export const ENGINE_SLUGS = {
  jofogas: "jofogas.hu",
  ingatlan: "ingatlan.com",
  auto: "hasznaltauto.hu",
} as const;

export type EngineSlug = (typeof ENGINE_SLUGS)[keyof typeof ENGINE_SLUGS];

/**
 * ingatlan.com builds list URLs as:
 *   https://ingatlan.com/lista/{segments}?page=N
 * where segments are `+`-joined filters from the search form, e.g.
 *   elado+lakas+budapest+xiii-ker+2-szoba+40-m2-tol+50-mFt-ig
 *   kiado+lakas+budapest+150-ezer-Ft-ig   (rent uses ezer-Ft, not mFt)
 * Legacy `/szukites/` paths still work on many pages.
 *
 * jofogas real-estate (ingatlan.jofogas.hu) uses query `st=u` for kiadó / `st=s` for eladó.
 */
export const ENGINES: EngineMeta[] = [
  {
    id: engineId(ENGINE_SLUGS.jofogas),
    slug: ENGINE_SLUGS.jofogas,
    name: "jofogas.hu",
    itemFields: ["id", "pos", "name", "price", "url", "image", "company", "post", "found"],
    options: [
      {
        id: "keywords",
        name: "Keywords",
        type: "text",
        placeholder: "iphone 13",
        description: "Search query on jofogas.hu (optional for category URLs)",
      },
      {
        id: "domain",
        name: "Platform URL",
        type: "url",
        default: "https://www.jofogas.hu/magyarorszag",
        description:
          "Base listing URL (region / category path). Real estate example: https://ingatlan.jofogas.hu/csongrad/arpadhalom/lakas",
      },
      {
        id: "st",
        name: "Offer type",
        type: "select",
        default: "",
        choices: [
          { value: "", label: "Any (general ads)" },
          { value: "s", label: "Eladó (for sale) — st=s" },
          { value: "u", label: "Kiadó (for rent) — st=u" },
        ],
        description:
          "Needed for ingatlan.jofogas.hu: use Kiadó (st=u) for albérlet / rental listings",
      },
      {
        id: "minPrice",
        name: "Min price (Ft)",
        type: "number",
        placeholder: "0",
      },
      {
        id: "maxPrice",
        name: "Max price (Ft)",
        type: "number",
        placeholder: "500000",
        description: "Monthly rent or sale price in full HUF",
      },
      {
        id: "enableCompany",
        name: "Include company ads",
        type: "checkbox",
        default: false,
      },
      {
        id: "enablePost",
        name: "Include postal ads",
        type: "checkbox",
        default: false,
      },
      {
        id: "depth",
        name: "Pages to scrape",
        type: "number",
        default: 5,
      },
    ],
  },
  {
    id: engineId(ENGINE_SLUGS.ingatlan),
    slug: ENGINE_SLUGS.ingatlan,
    name: "ingatlan.com",
    itemFields: ["id", "name", "where", "price", "area", "url", "image", "found"],
    options: [
      {
        id: "keywords",
        name: "Label (UI only)",
        type: "text",
        placeholder: "BP XIII 2 szoba",
        description: "Friendly name in the routines list — not sent to the site",
      },
      {
        id: "listingType",
        name: "Listing type",
        type: "select",
        default: "elado",
        choices: [
          { value: "elado", label: "Eladó (for sale)" },
          { value: "kiado", label: "Kiadó (for rent)" },
        ],
        description: "First segment of the /lista/ path",
      },
      {
        id: "propertyType",
        name: "Property type",
        type: "select",
        default: "lakas",
        choices: [
          { value: "lakas", label: "Lakás" },
          { value: "haz", label: "Ház" },
          { value: "telek", label: "Telek" },
          { value: "garazs", label: "Garázs" },
          { value: "nyaralo", label: "Nyaraló" },
          { value: "iroda", label: "Iroda" },
          { value: "uzlethelyiseg", label: "Üzlethelyiség" },
          { value: "ipari-ingatlan", label: "Ipari ingatlan" },
          { value: "mezogazdasagi-terulet", label: "Mezőgazdasági terület" },
          { value: "felepites-alatt", label: "Félépítés alatt" },
        ],
      },
      {
        id: "location",
        name: "Location",
        type: "text",
        default: "budapest",
        placeholder: "budapest+xiii-ker",
        description:
          "Location slug(s) as on the site, joined with +. Examples: budapest, budapest+xiii-ker, pest-megye, debrecen",
      },
      {
        id: "rooms",
        name: "Rooms",
        type: "select",
        default: "",
        choices: [
          { value: "", label: "Any" },
          { value: "1-szoba", label: "1 room" },
          { value: "1-2-szoba", label: "1–2 rooms" },
          { value: "2-szoba", label: "2 rooms" },
          { value: "2-3-szoba", label: "2–3 rooms" },
          { value: "3-szoba", label: "3 rooms" },
          { value: "3-szoba-felett", label: "3+ rooms" },
          { value: "4-szoba-felett", label: "4+ rooms" },
        ],
      },
      {
        id: "minArea",
        name: "Min area (m²)",
        type: "number",
        placeholder: "40",
        description: "Becomes {n}-m2-tol in the path",
      },
      {
        id: "maxArea",
        name: "Max area (m²)",
        type: "number",
        placeholder: "80",
        description: "Becomes {n}-m2-ig in the path",
      },
      {
        id: "minPrice",
        name: "Min price (Ft)",
        type: "number",
        placeholder: "30000000",
        description:
          "Full HUF. Eladó → mFt (e.g. 30000000 → 30-mFt-tol). Kiadó → monthly rent (e.g. 120000 → havi-120-ezer-Ft-tol).",
      },
      {
        id: "maxPrice",
        name: "Max price (Ft)",
        type: "number",
        placeholder: "60000000",
        description:
          "Full HUF. Eladó → mFt (e.g. 60000000 → 60-mFt-ig). Kiadó → monthly rent (e.g. 180000 → havi-180-ezer-Ft-ig).",
      },
      {
        id: "condition",
        name: "Condition",
        type: "select",
        default: "",
        choices: [
          { value: "", label: "Any" },
          { value: "uj-epitesu", label: "Új építésű" },
          { value: "ujszeru", label: "Újszerű" },
          { value: "jo-allapotu", label: "Jó állapotú" },
          { value: "felujitott", label: "Felújított" },
          { value: "felujitando", label: "Felújítandó" },
        ],
      },
      {
        id: "extraFilters",
        name: "Extra path filters",
        type: "text",
        placeholder: "erkeleyes+lift",
        description: "Optional extra +separated segments from the site (e.g. erkeleyes, panel, tarsashaz)",
      },
      {
        id: "search",
        name: "Advanced: full search path",
        type: "text",
        placeholder: "elado+lakas+budapest+xiii-ker+2-szoba",
        description:
          "If set, overrides the fields above. Paste the path after /lista/ or /szukites/ from the browser URL.",
      },
      {
        id: "listPath",
        name: "List base path",
        type: "select",
        default: "lista",
        choices: [
          { value: "lista", label: "/lista/ (current UI)" },
          { value: "szukites", label: "/szukites/ (legacy)" },
        ],
      },
      {
        id: "depth",
        name: "Pages to scrape",
        type: "number",
        default: 3,
      },
    ],
  },
  {
    id: engineId(ENGINE_SLUGS.auto),
    slug: ENGINE_SLUGS.auto,
    name: "hasznaltauto.hu",
    itemFields: ["id", "name", "price", "url", "image", "ad", "found"],
    options: [
      {
        id: "keywords",
        name: "Tag (label only)",
        type: "text",
        placeholder: "golf 7",
      },
      {
        id: "key",
        name: "Search key",
        type: "text",
        placeholder: "s/xyz123...",
        description: "Key segment from hasznaltauto.hu search results URL",
      },
      {
        id: "depth",
        name: "Pages to scrape",
        type: "number",
        default: 2,
      },
    ],
  },
];

/** Convert HUF integer to ingatlan path million-Ft token (e.g. 30_000_000 → "30"). */
function hufToMFtSegment(huf: number): string {
  const m = huf / 1_000_000;
  // Keep one decimal if needed (e.g. 35.5), otherwise integer
  const rounded = Math.round(m * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

/** Monthly rent HUF → ezer-Ft path token (e.g. 150_000 → "150"). */
function hufToEzerFtSegment(huf: number): string {
  const ezer = Math.round(huf / 1000);
  return String(Math.max(ezer, 0));
}

/**
 * Read price as HUF from routine.
 * Prefer full-HUF fields; legacy *MFt fields are treated as millions (sale only).
 */
function readPriceHuf(
  routine: Record<string, unknown>,
  hufKey: string,
  legacyMFtKey: string,
  /** When true, ignore legacy *MFt (those are sale-scale millions). */
  rentMode = false,
): number | null {
  const raw = routine[hufKey];
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  if (rentMode) return null;
  const legacy = routine[legacyMFtKey];
  if (legacy != null && legacy !== "") {
    const n = Number(legacy);
    if (Number.isFinite(n)) return n * 1_000_000;
  }
  return null;
}

/**
 * Rent price path segment as used by the live site, e.g.:
 *   havi-120-180-ezer-Ft
 *   havi-150-ezer-Ft-ig
 *   havi-100-ezer-Ft-tol
 */
function rentPriceSegment(minHuf: number | null, maxHuf: number | null): string | null {
  const minE = minHuf != null ? hufToEzerFtSegment(minHuf) : null;
  const maxE = maxHuf != null ? hufToEzerFtSegment(maxHuf) : null;
  if (minE != null && maxE != null) return `havi-${minE}-${maxE}-ezer-Ft`;
  if (minE != null) return `havi-${minE}-ezer-Ft-tol`;
  if (maxE != null) return `havi-${maxE}-ezer-Ft-ig`;
  return null;
}

function salePriceSegment(minHuf: number | null, maxHuf: number | null): string | null {
  const minM = minHuf != null ? hufToMFtSegment(minHuf) : null;
  const maxM = maxHuf != null ? hufToMFtSegment(maxHuf) : null;
  if (minM != null && maxM != null) return `${minM}-${maxM}-mFt`;
  if (minM != null) return `${minM}-mFt-tol`;
  if (maxM != null) return `${maxM}-mFt-ig`;
  return null;
}

/**
 * Build ingatlan.com path segments from structured routine fields.
 * If `search` is provided, it wins (advanced override).
 *
 * Live site order (from listingsPageEvent) for rent:
 *   kiado+lakas+havi-120-180-ezer-Ft+szeged
 * Sale typically:
 *   elado+lakas+budapest+…+50-mFt-ig
 */
export function buildIngatlanSearchPath(routine: Record<string, unknown>): string {
  const advanced = String(routine.search ?? "").trim();
  if (advanced) {
    return advanced
      .replace(/^\/+|\/+$/g, "")
      .replace(/^lista\/|^szukites\//, "")
      // fix older previews that omitted havi- for rent price ranges
      .replace(/(^|\+)(\d+-\d+-ezer-Ft)(?=\+|$)/g, "$1havi-$2")
      .replace(/(^|\+)(\d+-ezer-Ft-(?:tol|ig))(?=\+|$)/g, "$1havi-$2");
  }

  const parts: string[] = [];
  const listingType = String(routine.listingType || "elado");
  const propertyType = String(routine.propertyType || "lakas");
  parts.push(listingType, propertyType);

  const isRent = listingType === "kiado";
  const minHuf = readPriceHuf(routine, "minPrice", "minPriceMFt", isRent);
  const maxHuf = readPriceHuf(routine, "maxPrice", "maxPriceMFt", isRent);

  // Rent: price filter comes before location (site canonical order)
  if (isRent) {
    const rentSeg = rentPriceSegment(minHuf, maxHuf);
    if (rentSeg) parts.push(rentSeg);
  }

  const location = String(routine.location || "").trim();
  if (location) {
    for (const seg of location.split("+").map((s) => s.trim()).filter(Boolean)) {
      parts.push(seg);
    }
  }

  const rooms = String(routine.rooms || "").trim();
  if (rooms) parts.push(rooms);

  const minArea = routine.minArea != null && routine.minArea !== "" ? Number(routine.minArea) : null;
  const maxArea = routine.maxArea != null && routine.maxArea !== "" ? Number(routine.maxArea) : null;
  if (minArea != null && Number.isFinite(minArea) && maxArea != null && Number.isFinite(maxArea)) {
    parts.push(`${Math.floor(minArea)}-${Math.floor(maxArea)}-m2`);
  } else {
    if (minArea != null && Number.isFinite(minArea)) parts.push(`${Math.floor(minArea)}-m2-tol`);
    if (maxArea != null && Number.isFinite(maxArea)) parts.push(`${Math.floor(maxArea)}-m2-ig`);
  }

  // Sale: price after location / rooms / area
  if (!isRent) {
    const saleSeg = salePriceSegment(minHuf, maxHuf);
    if (saleSeg) parts.push(saleSeg);
  }

  const condition = String(routine.condition || "").trim();
  if (condition) parts.push(condition);

  const extra = String(routine.extraFilters || "").trim();
  if (extra) {
    for (const seg of extra.split("+").map((s) => s.trim()).filter(Boolean)) {
      parts.push(seg);
    }
  }

  return parts.filter(Boolean).join("+");
}

const JOFOGAS_DEFAULT_DOMAIN = "https://www.jofogas.hu/magyarorszag";
const HASZNALTAUTO_LIST_BASE = "https://www.hasznaltauto.hu/talalatilista";
const INGATLAN_BASE = "https://ingatlan.com";

function optionalNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build jofogas.hu / ingatlan.jofogas.hu search URL from routine fields (page 1).
 * `st=u` = kiadó (rent), `st=s` = eladó (sale) — required for property listings.
 */
export function buildJofogasSearchUrl(routine: Record<string, unknown>): string {
  const domain = String(routine.domain || JOFOGAS_DEFAULT_DOMAIN).replace(/\/$/, "");
  const keywords = String(routine.keywords ?? "").trim();
  const minPrice = optionalNumber(routine.minPrice);
  const maxPrice = optionalNumber(routine.maxPrice);
  // Accept st, or map listingType from mixed forms: kiado/u → u, elado/s → s
  const rawSt = String(routine.st ?? routine.offerType ?? "").trim().toLowerCase();
  const listingType = String(routine.listingType ?? "").trim().toLowerCase();
  let st = rawSt;
  if (!st) {
    if (listingType === "kiado" || listingType === "u") st = "u";
    else if (listingType === "elado" || listingType === "s") st = "s";
  } else if (st === "kiado") st = "u";
  else if (st === "elado") st = "s";

  const params = new URLSearchParams();
  if (keywords) params.set("q", keywords);
  if (minPrice != null) params.set("min_price", String(minPrice));
  if (maxPrice != null) params.set("max_price", String(maxPrice));
  if (st === "u" || st === "s") params.set("st", st);

  const qs = params.toString();
  return qs ? `${domain}?${qs}` : domain;
}

/**
 * Build hasznaltauto.hu result-list URL.
 * `key` is the path segment after /talalatilista/ from a saved search.
 */
export function buildHasznaltautoSearchUrl(
  routine: Record<string, unknown>,
  page = 1,
): string | null {
  const key = String(routine.key ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  if (!key) return null;
  const p = Math.max(1, Math.floor(page) || 1);
  return `${HASZNALTAUTO_LIST_BASE}/${key}/page${p}`;
}

/** Full ingatlan.com list URL for page 1. */
export function buildIngatlanSearchUrl(routine: Record<string, unknown>): string | null {
  const searchPath = buildIngatlanSearchPath(routine);
  if (!searchPath) return null;
  const listBase = String(routine.listPath || "lista").replace(/^\/+|\/+$/g, "") || "lista";
  return `${INGATLAN_BASE}/${listBase}/${searchPath}`;
}

export type RoutinePreview = {
  /** Absolute URL the scraper will open (page 1 when paginated). */
  url: string | null;
  /** Short path/query hint shown under the label. */
  path: string | null;
  /** Why preview is missing (e.g. required field empty). */
  hint?: string;
};

/**
 * Live search URL preview for the routines editor.
 * Matches scraper URL construction for each engine.
 */
export function buildRoutinePreview(
  slug: string | undefined | null,
  routine: Record<string, unknown>,
): RoutinePreview {
  if (!slug) {
    return { url: null, path: null, hint: "Select an engine" };
  }

  if (slug === ENGINE_SLUGS.jofogas || slug === "jofogas.hu") {
    const url = buildJofogasSearchUrl(routine);
    try {
      const u = new URL(url);
      const path = `${u.pathname}${u.search}`;
      return { url, path };
    } catch {
      return { url, path: url };
    }
  }

  if (slug === ENGINE_SLUGS.ingatlan || slug === "ingatlan.com") {
    const searchPath = buildIngatlanSearchPath(routine);
    const listBase = String(routine.listPath || "lista").replace(/^\/+|\/+$/g, "") || "lista";
    if (!searchPath) {
      return {
        url: null,
        path: null,
        hint: "Fill listing type / location, or paste a full search path",
      };
    }
    const path = `/${listBase}/${searchPath}`;
    return { url: `${INGATLAN_BASE}${path}`, path };
  }

  if (slug === ENGINE_SLUGS.auto || slug === "hasznaltauto.hu") {
    const url = buildHasznaltautoSearchUrl(routine, 1);
    if (!url) {
      return {
        url: null,
        path: null,
        hint: "Paste the search key from a hasznaltauto.hu results URL",
      };
    }
    try {
      const u = new URL(url);
      return { url, path: u.pathname };
    } catch {
      return { url, path: url };
    }
  }

  return { url: null, path: null, hint: "Unknown engine" };
}

export function findEngineById(id: number): EngineMeta | undefined {
  return ENGINES.find((e) => e.id === id);
}

export function findEngineBySlug(slug: string): EngineMeta | undefined {
  return ENGINES.find((e) => e.slug === slug || e.name === slug);
}

export function formatPrice(price: number | string | null | undefined): string {
  if (price === null || price === undefined || price === "") return "—";
  const n = typeof price === "string" ? Number(String(price).replace(/\s/g, "")) : price;
  if (Number.isNaN(n)) return String(price);
  return n.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, " ") + " Ft";
}
