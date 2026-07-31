import type { Page } from "playwright";
import type { ListingItemDetails, ScrapedItem } from "@watcher/shared";

/** Per-engine scrape outcome with pagination quality signals */
export interface EngineScrapeResult {
  items: ScrapedItem[];
  /** Planned max pages (depth) */
  pagesPlanned: number;
  /** Successfully loaded + parsed pages */
  pagesFetched: number;
  /** Navigation/parse hard failures */
  pagesFailed: number;
  /**
   * True when we finished without hard failures.
   * Empty results with no failures still count as complete.
   */
  complete: boolean;
  error?: string;
}

/** Engine-owned result of scraping one listing detail page */
export interface EngineItemScrapeResult {
  details: ListingItemDetails | null;
  name?: string | null;
  price?: number | null;
  image?: string | null;
  error?: string;
}

export interface ScrapeItemInput {
  url: string;
  listingId?: string;
}

/**
 * Each engine implements list scrape + optional item-page scrape.
 * Item scrape shape is fully controlled by the engine (details payload).
 */
export interface EngineScraper {
  slug: string;
  name: string;
  scrape(page: Page, routine: Record<string, unknown>): Promise<EngineScrapeResult>;
  scrapeItem(page: Page, input: ScrapeItemInput): Promise<EngineItemScrapeResult>;
}

export function emptyResult(pagesPlanned: number, error?: string): EngineScrapeResult {
  return {
    items: [],
    pagesPlanned,
    pagesFetched: 0,
    pagesFailed: error ? 1 : 0,
    complete: !error,
    error,
  };
}
