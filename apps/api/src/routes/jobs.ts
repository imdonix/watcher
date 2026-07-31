import { Hono } from "hono";
import { asc, desc, eq, sql } from "drizzle-orm";
import {
  scrapeRoutineResults,
  scrapeRuns,
  searchRoutines,
  type Database,
} from "@watcher/db";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { getEngines, getSchedulerStatus, startScrapAll } from "../services/processor";
import { notifyAll, transportsStatus } from "../services/notify";
import { scraperHealth } from "../services/scraper-client";
import { countSubscriptions, isPushConfigured } from "../services/push";
import { log } from "../lib/time";
import { ENGINES, ITEM_DETAILS_JOB_SLUG } from "@watcher/shared";

const STATUS_RUNS_LIMIT = 10;

function mapRun(r: typeof scrapeRuns.$inferSelect) {
  return {
    id: r.id,
    status: r.status,
    listingsFound: r.listingsFound,
    routinesTotal: r.routinesTotal,
    routinesComplete: r.routinesComplete,
    sightingsCreated: r.sightingsCreated,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    error: r.error,
  };
}

/** Human-readable label from routine config for status UI. */
function routineLabel(config: Record<string, unknown> | null | undefined): string | null {
  if (!config) return null;
  const keys = ["keywords", "key", "path", "listaPath", "query", "url"] as const;
  for (const k of keys) {
    const v = config[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

function jobDisplayLabel(
  engineSlug: string,
  config: Record<string, unknown> | null | undefined,
): string | null {
  if (engineSlug === ITEM_DETAILS_JOB_SLUG) return "Item detail pages";
  return routineLabel(config);
}

export function jobRoutes(db: Database) {
  const app = new Hono<AuthEnv>();

  app.get("/scrappers", (c) => {
    log("API", "Request scrappers");
    return c.json(getEngines());
  });

  app.get("/engines", (c) => {
    return c.json(getEngines());
  });

  app.get("/health", async (c) => {
    const scraperOk = await scraperHealth();
    return c.json({
      ok: true,
      scraper: scraperOk,
      transports: transportsStatus(),
      engines: ENGINES.length,
    });
  });

  /** Full status dashboard payload (latest 10 runs only). */
  app.get("/status", requireAuth, async (c) => {
    let dbOk = false;
    let dbDetail = "";
    try {
      await db.execute(sql`SELECT 1`);
      dbOk = true;
    } catch (err) {
      dbDetail = String(err);
    }

    const scraperOk = await scraperHealth();
    const runs = await db
      .select()
      .from(scrapeRuns)
      .orderBy(desc(scrapeRuns.startedAt))
      .limit(STATUS_RUNS_LIMIT);

    const scheduler = getSchedulerStatus();

    return c.json({
      ok: dbOk && scraperOk,
      services: [
        { name: "api", ok: true, detail: "up" },
        { name: "database", ok: dbOk, detail: dbOk ? "reachable" : dbDetail },
        {
          name: "scraper",
          ok: scraperOk,
          detail: scraperOk ? "healthy" : "unreachable",
        },
        {
          name: "web-push",
          ok: isPushConfigured(),
          detail: isPushConfigured() ? "vapid configured" : "not configured",
        },
      ],
      scheduler,
      runs: runs.map(mapRun),
      transports: transportsStatus(),
      pushSubscribers: await countSubscriptions(db),
    });
  });

  /** Start a scrape asynchronously — does not wait for completion. */
  app.post("/scrap", requireAuth, async (c) => {
    log("API", "Force Scrap (async start)");
    const result = startScrapAll(db);
    if (result.alreadyRunning) {
      return c.json(
        {
          ok: true,
          started: false,
          alreadyRunning: true,
          message: "Scrape already in progress",
        },
        202,
      );
    }
    return c.json(
      {
        ok: true,
        started: true,
        alreadyRunning: false,
        message: "Scrape started",
      },
      202,
    );
  });

  app.post("/notify", requireAuth, async (c) => {
    log("API", "Force Notify");
    try {
      const sent = await notifyAll(db);
      return c.json({ sent });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  app.get("/runs", requireAuth, async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? STATUS_RUNS_LIMIT), 50);
    const rows = await db
      .select()
      .from(scrapeRuns)
      .orderBy(desc(scrapeRuns.startedAt))
      .limit(limit);
    return c.json(rows.map(mapRun));
  });

  /** Per-routine jobs that belonged to a scrape run. */
  app.get("/runs/:id/jobs", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id) || id < 1) {
      return c.json({ error: "Invalid run id" }, 400);
    }

    const [run] = await db.select({ id: scrapeRuns.id }).from(scrapeRuns).where(eq(scrapeRuns.id, id)).limit(1);
    if (!run) return c.json({ error: "Run not found" }, 404);

    const rows = await db
      .select({
        id: scrapeRoutineResults.id,
        scrapeRunId: scrapeRoutineResults.scrapeRunId,
        searchRoutineId: scrapeRoutineResults.searchRoutineId,
        engineSlug: scrapeRoutineResults.engineSlug,
        complete: scrapeRoutineResults.complete,
        pagesPlanned: scrapeRoutineResults.pagesPlanned,
        pagesFetched: scrapeRoutineResults.pagesFetched,
        pagesFailed: scrapeRoutineResults.pagesFailed,
        itemsSeen: scrapeRoutineResults.itemsSeen,
        error: scrapeRoutineResults.error,
        config: searchRoutines.config,
      })
      .from(scrapeRoutineResults)
      .leftJoin(
        searchRoutines,
        eq(scrapeRoutineResults.searchRoutineId, searchRoutines.id),
      )
      .where(eq(scrapeRoutineResults.scrapeRunId, id))
      .orderBy(asc(scrapeRoutineResults.id));

    return c.json(
      rows.map((r) => ({
        id: r.id,
        scrapeRunId: r.scrapeRunId,
        searchRoutineId: r.searchRoutineId,
        engineSlug: r.engineSlug,
        complete: r.complete,
        pagesPlanned: r.pagesPlanned,
        pagesFetched: r.pagesFetched,
        pagesFailed: r.pagesFailed,
        itemsSeen: r.itemsSeen,
        error: r.error,
        label: jobDisplayLabel(r.engineSlug, r.config),
      })),
    );
  });

  return app;
}
