import { Hono } from "hono";
import { createRequire } from "node:module";
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
import {
  AI_EVALUATION_JOB_SLUG,
  ENGINES,
  ITEM_DETAILS_JOB_SLUG,
  MARKET_CHECK_JOB_SLUG,
} from "@watcher/shared";

const STATUS_RUNS_LIMIT = 10;
const requirePackage = createRequire(import.meta.url);

/** Read a dependency's declared version without importing its internals. */
function packageVersion(name: string): string {
  try {
    const pkg = requirePackage(`${name}/package.json`) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

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
  if (engineSlug === AI_EVALUATION_JOB_SLUG) return "AI evaluation";
  if (engineSlug === MARKET_CHECK_JOB_SLUG) return "Market check";
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
    const scraper = await scraperHealth();
    return c.json({
      ok: true,
      scraper: scraper.ok,
      transports: transportsStatus(),
      engines: ENGINES.length,
    });
  });

  /** Full status dashboard payload (latest 10 runs only). */
  /** Lightweight scrape-state poll for the navbar — in-memory only, no DB/scraper calls. */
  app.get("/scrape-status", requireAuth, (c) => {
    const { scrapeInProgress, scrapeProgress } = getSchedulerStatus();
    return c.json({
      inProgress: scrapeInProgress === true,
      progress: scrapeProgress ?? null,
    });
  });

  app.get("/status", requireAuth, async (c) => {
    let dbOk = false;
    let dbDetail = "";
    let pgVersion: string | null = null;
    try {
      const rows = await db.execute<{ version: string }>(
        sql`SELECT current_setting('server_version') AS version`,
      );
      pgVersion = rows[0]?.version ?? null;
      dbOk = true;
    } catch (err) {
      dbDetail = String(err);
    }

    const scraper = await scraperHealth();
    const runs = await db
      .select()
      .from(scrapeRuns)
      .orderBy(desc(scrapeRuns.startedAt))
      .limit(STATUS_RUNS_LIMIT);

    const scheduler = getSchedulerStatus();

    return c.json({
      ok: dbOk && scraper.ok,
      services: [
        {
          name: "api",
          ok: true,
          detail: "up",
          versions: [
            { name: "Bun", version: Bun.version },
            { name: "Hono", version: packageVersion("hono") },
          ],
        },
        {
          name: "database",
          ok: dbOk,
          detail: dbOk ? "reachable" : dbDetail,
          versions: dbOk
            ? [
                ...(pgVersion ? [{ name: "PostgreSQL", version: pgVersion }] : []),
                { name: "postgres.js", version: packageVersion("postgres") },
              ]
            : [],
        },
        {
          name: "scraper",
          ok: scraper.ok,
          detail: scraper.ok ? "healthy" : "unreachable",
          versions: scraper.versions,
        },
        {
          name: "web-push",
          ok: isPushConfigured(),
          detail: isPushConfigured() ? "vapid configured" : "not configured",
          versions: [{ name: "web-push", version: packageVersion("web-push") }],
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
