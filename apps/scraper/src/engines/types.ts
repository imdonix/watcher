import type { Page } from "playwright";
import type { ScrapedItem } from "@watcher/shared";

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

export interface EngineScraper {
  slug: string;
  name: string;
  scrape(page: Page, routine: Record<string, unknown>): Promise<EngineScrapeResult>;
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
