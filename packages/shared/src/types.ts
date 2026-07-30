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

/** Result of one engine scrape for one routine */
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
  [key: string]: unknown;
}

export interface ListingDetailResponse {
  listing: ItemView & {
    imageUrl?: string | null;
    lastData?: Record<string, unknown>;
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
}

export interface ServiceHealth {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface StatusResponse {
  ok: boolean;
  services: ServiceHealth[];
  scheduler: SchedulerStatus;
  runs: Array<{
    id: number;
    status: string;
    listingsFound: number | null;
    routinesTotal: number | null;
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
  }>;
  transports: { logger: boolean; push: boolean };
  pushSubscribers: number;
}

export type ListingEventKind = "first_seen" | "price_change" | "missing" | "reappeared";
