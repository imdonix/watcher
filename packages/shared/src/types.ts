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

export interface ItemView {
  id: string;
  name: string;
  url: string;
  image?: string | null;
  price: number | null;
  priceFormatted?: string;
  engineSlug?: string;
  status: ListingStatus;
  /** User dismissed; same UI as unavailable until price changes */
  notInterested?: boolean;
  notInterestedAt?: string | null;
  /** status===active && !notInterested */
  available?: boolean;
  firstSeenAt?: string;
  lastSeenAt?: string;
  sightingCount?: number;
  sent?: boolean;
  found?: string;
  /** AI evaluation verdict (null / absent = not evaluated yet) */
  aiVerdict?: "pass" | "fail" | null;
  aiReason?: string | null;
  aiModel?: string | null;
  aiEvaluatedAt?: string | null;
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

export type ListingEventKind = "first_seen" | "price_change" | "missing" | "reappeared";

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
}
