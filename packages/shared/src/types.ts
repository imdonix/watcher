export type FieldType = "text" | "number" | "url" | "checkbox" | "select";

export interface EngineOption {
  id: string;
  name: string;
  type: FieldType;
  default?: string | number | boolean;
  description?: string;
  placeholder?: string;
  choices?: Array<{ value: string; label: string }>;
}

export interface EngineMeta {
  id: number;
  slug: string;
  name: string;
  options: EngineOption[];
  itemFields: string[];
}

export interface ScrapedItem {
  id: string;
  name: string;
  price: number | null;
  url: string;
  image?: string | null;
  found?: string;
  [key: string]: unknown;
}

/**
 * Engine-controlled payload from an individual listing page scrape.
 * Each engine decides which attributes / extras make sense for its site.
 */
export interface ListingItemDetails {
  description?: string | null;
  images?: string[];
  /** Free-form facts (rooms, mileage, seller type, …) */
  attributes?: Record<string, string | number | boolean | null>;
  /** Engine-private structured extras */
  extra?: Record<string, unknown>;
}

/** Result of one engine scrape for one routine (search / list pages) */
export interface ScrapeJobResult {
  ok: boolean;
  /**
   * True only when pagination finished without hard page failures.
   * Incomplete scrapes must NOT mark listings as missing.
   */
  complete: boolean;
  pagesPlanned: number;
  pagesFetched: number;
  pagesFailed: number;
  items: ScrapedItem[];
  engine: string;
  error?: string;
  durationMs?: number;
}

export interface ScrapeJobRequest {
  engine: string;
  routine: Record<string, unknown>;
}

/** Request to scrape a single listing detail page */
export interface ScrapeItemRequest {
  engine: string;
  url: string;
  listingId?: string;
}

export interface ScrapeItemResult {
  ok: boolean;
  engine: string;
  url: string;
  details: ListingItemDetails | null;
  /** Optional list-level field upgrades from the detail page */
  name?: string | null;
  price?: number | null;
  image?: string | null;
  error?: string;
  durationMs?: number;
}

/** Synthetic engine slug for the per-run item-details job in scrape_routine_results */
export const ITEM_DETAILS_JOB_SLUG = "__item_details__";

/** Synthetic engine slug for the per-run AI evaluation job in scrape_routine_results */
export const AI_EVALUATION_JOB_SLUG = "__ai_evaluate__";

export type ListingStatus = "active" | "missing";

/** One shop offer collected from Árukereső. */
export interface ShopPriceOffer {
  store: string | null;
  price: number;
  name?: string | null;
  url?: string | null;
}

/** Result of an Árukereső shop-price lookup (executed by the scraper service). */
export interface ShopPriceResult {
  ok: boolean;
  query: string;
  /** Árukereső search URL that was opened. */
  url: string;
  /** Estimated shop price: median of the matched shop offers. */
  price: number | null;
  lowest: number | null;
  highest: number | null;
  sampleSize: number;
  offers: ShopPriceOffer[];
  productName: string | null;
  productUrl: string | null;
  /** "model" = exact model token match; "similar" = broader product match. */
  confidence: "model" | "similar";
  /** Normalized tokens shared by the query and the matched product. */
  matchedTokens: string[];
  error?: string;
  durationMs?: number;
}

export interface ShopPriceRequest {
  query: string;
}

/** Shop price context compared with the listing's resale price. */
export interface DealMarket {
  /** Estimated online shop price from Árukereső (median of shop offers). */
  shopPrice: number;
  /** Cheapest / most expensive shop offer used for the estimate. */
  shopPriceLow: number;
  shopPriceHigh: number;
  /** This listing's current resale price. */
  resellPrice: number;
  /** Number of shop offers behind the estimate. */
  sampleSize: number;
  /** Negative = resale is cheaper than the shop price. */
  deltaPct: number;
  /** Positive = estimated saving vs. buying new (HUF). */
  savings: number;
  /** "model" = exact model token match; "similar" = broader product match. */
  confidence: "model" | "similar";
  /** Normalized tokens shared by the listing and the matched product. */
  matchedTokens: string[];
  /** The Árukereső product used for the comparison. */
  productName?: string | null;
  productUrl?: string | null;
  source: "arukereso";
  fetchedAt?: string | null;
}

export interface ListingDeal {
  market: DealMarket | null;
  /** Current price is the lowest ever observed (with at least one higher price). */
  allTimeLow: boolean;
  lowestPrice: number | null;
  highestPrice: number | null;
  observations: number;
}

export interface ItemView {
  id: string;
  name: string;
  url: string;
  image?: string | null;
  price: number | null;
  priceFormatted?: string;
  engineSlug?: string;
  status: ListingStatus;
  /** Hidden from the potential-products feed (user dismissal or AI reject) */
  notInterested?: boolean;
  notInterestedAt?: string | null;
  /** Why it is hidden: "user" (manual) or "ai" (automatic rejection) */
  notInterestedReason?: "user" | "ai" | null;
  /** status===active && !notInterested */
  available?: boolean;
  firstSeenAt?: string;
  lastSeenAt?: string;
  sightingCount?: number;
  sent?: boolean;
  found?: string;
  /** AI evaluation verdict (null / absent = not evaluated yet) — derived from aiScore >= threshold */
  aiVerdict?: "pass" | "fail" | null;
  /** AI relevance score 0-100 (null / absent = not evaluated yet) */
  aiScore?: number | null;
  aiReason?: string | null;
  aiModel?: string | null;
  aiEvaluatedAt?: string | null;
  /** Price before the most recent change (absent when never changed) */
  prevPrice?: number | null;
  priceChangedAt?: string | null;
  /** Alert threshold set by the user (null = none) */
  targetPrice?: number | null;
  /** Market comparison + all-time low context */
  deal?: ListingDeal | null;
  [key: string]: unknown;
}

export interface ListingDetailResponse {
  listing: ItemView & {
    imageUrl?: string | null;
    lastData?: Record<string, unknown>;
    details?: ListingItemDetails | null;
    detailsScrapedAt?: string | null;
  };
  sightings: Array<{
    id: number;
    listingId: string;
    scrapeRunId: number;
    searchRoutineId: number | null;
    observedAt: string;
    price: number | null;
    data: Record<string, unknown>;
  }>;
  events: Array<{
    id: number;
    listingId: string;
    kind: string;
    oldPrice: number | null;
    newPrice: number | null;
    notified: boolean;
    createdAt: string;
  }>;
  priceHistory: Array<{ at: string; price: number | null; scrapeRunId: number }>;
}

export interface LoginResponse {
  ok: boolean;
  token: string;
}

export interface NotifyResult {
  sent: number;
}

export interface ApiError {
  error: string;
  details?: string;
}

/** Live scrape progress while a run is active (null / idle when not scraping). */
export interface ScrapeProgress {
  phase: "idle" | "starting" | "routine" | "details" | "ai" | "finishing" | "notify";
  /** Human-readable line for the UI banner */
  message: string;
  runId?: number | null;
  /** 1-based index of the routine currently scraping */
  routineIndex?: number | null;
  routinesTotal?: number | null;
  engineSlug?: string | null;
  engineName?: string | null;
  routineLabel?: string | null;
  /** Listings seen so far in this run (after each routine ingest) */
  listingsSeen?: number | null;
  /** Item-detail job progress */
  detailsIndex?: number | null;
  detailsTotal?: number | null;
  startedAt?: string | null;
}

export interface SchedulerStatus {
  scrapIntervalMinutes: number;
  /** @deprecated clock-based notify removed — kept for older clients */
  notifyHour?: number;
  nextScrapeAt: string | null;
  nextNotifyAt: string | null;
  /** after_scrape = push when each scrape finishes */
  notifyMode?: "after_scrape" | "scheduled";
  lastScrapeAt: string | null;
  lastNotifyAt?: string | null;
  scraperStartedAt: string;
  scrapeInProgress?: boolean;
  /** Present while scrapeInProgress; describes current step */
  scrapeProgress?: ScrapeProgress | null;
}

export interface ServiceHealth {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface ScrapeRunSummary {
  id: number;
  status: string;
  listingsFound: number | null;
  routinesTotal: number | null;
  routinesComplete: number | null;
  sightingsCreated: number | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

/** One routine job inside a scrape run */
export interface ScrapeRunJob {
  id: number;
  scrapeRunId: number;
  searchRoutineId: number | null;
  engineSlug: string;
  complete: boolean;
  pagesPlanned: number | null;
  pagesFetched: number | null;
  pagesFailed: number | null;
  itemsSeen: number | null;
  error: string | null;
  /** Short label from routine config (keywords / path / key) */
  label: string | null;
}

export interface StatusResponse {
  ok: boolean;
  services: ServiceHealth[];
  scheduler: SchedulerStatus;
  runs: ScrapeRunSummary[];
  transports: { logger: boolean; push: boolean };
  pushSubscribers: number;
}

export type ListingEventKind =
  | "first_seen"
  | "price_change"
  | "target_hit"
  | "missing"
  | "reappeared";

/** System settings (persisted in `settings` table). */
export interface SystemSettings {
  scrapIntervalMinutes: number;
  scrapIntervalMin: number;
  scrapIntervalMax: number;
  nextScrapeAt: string | null;
  lastScrapeAt: string | null;
  /** AI listing evaluation (Ollama-compatible chat API) */
  aiEnabled: boolean;
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  /** Score >= this counts as pass (0-100, default 65) */
  aiPassThreshold: number;
}

export interface AiUsageModel {
  model: string;
  requests: number;
  usd: number;
  inputTokens: number;
  outputTokens: number;
}

/** Balance + usage details from an Ollama-compatible endpoint. */
export interface AiUsageResponse {
  ok: boolean;
  /** Human-readable reason when usage is unavailable or partial. */
  detail?: string;
  /** Included credit usage for the current period (0–100). */
  usedPct?: number | null;
  remainingPct?: number | null;
  includedBalanceUsd?: number | null;
  includedAllowanceUsd?: number | null;
  purchasedBalanceUsd?: number | null;
  periodFrom?: string | null;
  periodUntil?: string | null;
  /** Legacy plan limits (remaining percentages). */
  sessionRemainingPct?: number | null;
  sessionResetsAt?: string | null;
  weeklyRemainingPct?: number | null;
  weeklyResetsAt?: string | null;
  usage30d?: {
    requests: number;
    usd: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  } | null;
  models?: AiUsageModel[];
  fetchedAt?: string;
}
