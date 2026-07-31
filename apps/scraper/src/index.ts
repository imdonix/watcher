import { Hono } from "hono";
import type {
  ScrapeItemRequest,
  ScrapeItemResult,
  ScrapeJobRequest,
  ScrapeJobResult,
} from "@watcher/shared";
import { pool } from "./browser";
import { getScraper, listEngines } from "./engines";
import { log, logError } from "./lib/log";

const port = Number(process.env.SCRAPER_PORT || 3001);

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, service: "scraper" }));

app.get("/engines", (c) => c.json(listEngines()));

app.post("/scrape", async (c) => {
  const body = (await c.req.json()) as ScrapeJobRequest;
  const engineKey = body.engine;
  const routine = body.routine ?? {};

  if (!engineKey) {
    return c.json(
      {
        ok: false,
        complete: false,
        pagesPlanned: 0,
        pagesFetched: 0,
        pagesFailed: 0,
        items: [],
        engine: "",
        error: "engine required",
      } satisfies ScrapeJobResult,
      400,
    );
  }

  const scraper = getScraper(engineKey);
  if (!scraper) {
    return c.json(
      {
        ok: false,
        complete: false,
        pagesPlanned: 0,
        pagesFetched: 0,
        pagesFailed: 0,
        items: [],
        engine: engineKey,
        error: `Unknown engine: ${engineKey}`,
      } satisfies ScrapeJobResult,
      400,
    );
  }

  const started = Date.now();
  log("Scrape", `start ${scraper.slug} keywords=${String(routine.keywords ?? "")}`);

  try {
    const result = await pool.withPage(async (page) => scraper.scrape(page, routine));
    const durationMs = Date.now() - started;
    log(
      "Scrape",
      `done ${scraper.slug} items=${result.items.length} pages=${result.pagesFetched}/${result.pagesPlanned} failed=${result.pagesFailed} complete=${result.complete} ${durationMs}ms`,
    );
    return c.json({
      ok: true,
      complete: result.complete,
      pagesPlanned: result.pagesPlanned,
      pagesFetched: result.pagesFetched,
      pagesFailed: result.pagesFailed,
      items: result.items,
      engine: scraper.slug,
      durationMs,
      error: result.error,
    } satisfies ScrapeJobResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("Scrape", `${scraper.slug}: ${message}`);
    return c.json(
      {
        ok: false,
        complete: false,
        pagesPlanned: 0,
        pagesFetched: 0,
        pagesFailed: 1,
        items: [],
        engine: scraper.slug,
        error: message,
        durationMs: Date.now() - started,
      } satisfies ScrapeJobResult,
      500,
    );
  }
});

/** One-shot item detail page scrape (engine-defined shape). */
app.post("/scrape-item", async (c) => {
  const body = (await c.req.json()) as ScrapeItemRequest;
  const engineKey = body.engine;
  const url = String(body.url || "").trim();

  if (!engineKey || !url) {
    return c.json(
      {
        ok: false,
        engine: engineKey || "",
        url,
        details: null,
        error: "engine and url required",
      } satisfies ScrapeItemResult,
      400,
    );
  }

  const scraper = getScraper(engineKey);
  if (!scraper) {
    return c.json(
      {
        ok: false,
        engine: engineKey,
        url,
        details: null,
        error: `Unknown engine: ${engineKey}`,
      } satisfies ScrapeItemResult,
      400,
    );
  }

  const started = Date.now();
  log("ScrapeItem", `start ${scraper.slug} ${url}`);

  try {
    const result = await pool.withPage(async (page) =>
      scraper.scrapeItem(page, { url, listingId: body.listingId }),
    );
    const durationMs = Date.now() - started;
    const ok = Boolean(result.details) && !result.error;
    log(
      "ScrapeItem",
      `done ${scraper.slug} ok=${ok} attrs=${Object.keys(result.details?.attributes ?? {}).length} ${durationMs}ms`,
    );
    return c.json({
      ok,
      engine: scraper.slug,
      url,
      details: result.details,
      name: result.name,
      price: result.price,
      image: result.image,
      error: result.error,
      durationMs,
    } satisfies ScrapeItemResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("ScrapeItem", `${scraper.slug}: ${message}`);
    return c.json(
      {
        ok: false,
        engine: scraper.slug,
        url,
        details: null,
        error: message,
        durationMs: Date.now() - started,
      } satisfies ScrapeItemResult,
      500,
    );
  }
});

async function main() {
  await pool.init();
  log("HTTP", `scraper listening on :${port}`);

  Bun.serve({
    port,
    fetch: app.fetch,
  });

  const shutdown = async () => {
    log("HTTP", "shutting down");
    await pool.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logError("Fatal", String(err));
  process.exit(1);
});
