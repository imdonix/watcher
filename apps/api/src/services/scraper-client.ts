import type { ScrapeJobRequest, ScrapeJobResult } from "@watcher/shared";
import { env } from "../env";
import { log, logError } from "../lib/time";

export async function runScrapeJob(req: ScrapeJobRequest): Promise<ScrapeJobResult> {
  const url = `${env.scraperUrl.replace(/\/$/, "")}/scrape`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logError("ScraperClient", `HTTP ${res.status}: ${text}`);
      return {
        ok: false,
        complete: false,
        pagesPlanned: 0,
        pagesFetched: 0,
        pagesFailed: 1,
        items: [],
        engine: req.engine,
        error: `Scraper HTTP ${res.status}`,
      };
    }

    return (await res.json()) as ScrapeJobResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("ScraperClient", message);
    return {
      ok: false,
      complete: false,
      pagesPlanned: 0,
      pagesFetched: 0,
      pagesFailed: 1,
      items: [],
      engine: req.engine,
      error: message,
    };
  }
}

export async function scraperHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${env.scraperUrl.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listRemoteEngines(): Promise<unknown> {
  try {
    const res = await fetch(`${env.scraperUrl.replace(/\/$/, "")}/engines`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    log("ScraperClient", `engines list failed: ${err}`);
    return null;
  }
}
