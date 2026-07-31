import { eq } from "drizzle-orm";
import {
  schedulerState,
  searchRoutines,
  scrapeRuns,
  type Database,
} from "@watcher/db";
import { ENGINES, findEngineById, type ScrapeProgress } from "@watcher/shared";
import { env } from "../env";
import { log, logError } from "../lib/time";
import { runScrapeJob } from "./scraper-client";
import { notifyAfterScrape } from "./notify";
import { ingestRoutineScrape } from "./listing-ingest";
import { runItemDetailsJob } from "./item-details";

const STATE_ID = 1;

let tickTimer: ReturnType<typeof setInterval> | null = null;
let scraping = false;

const processStartedAt = new Date();
let lastScrapeAt: Date | null = null;
let nextScrapeAt: Date | null = null;
let lastNotifyAt: Date | null = null;

const idleProgress = (): ScrapeProgress => ({
  phase: "idle",
  message: "",
});

let scrapeProgress: ScrapeProgress = idleProgress();

function setProgress( partial: Partial<ScrapeProgress> & Pick<ScrapeProgress, "phase" | "message">): void {
  scrapeProgress = {
    ...scrapeProgress,
    ...partial,
  };
}

function routineLabelFromConfig(config: Record<string, unknown>): string | null {
  for (const k of ["keywords", "key", "path", "listaPath", "query", "location"] as const) {
    const v = config[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

function scrapIntervalMs(): number {
  return Math.max(1, env.scrapIntervalMinutes) * 60_000;
}

async function loadState(db: Database) {
  const rows = await db
    .select()
    .from(schedulerState)
    .where(eq(schedulerState.id, STATE_ID))
    .limit(1);

  if (rows.length === 0) {
    const now = new Date();
    const firstScrape = new Date(now.getTime() + 30_000);
    await db.insert(schedulerState).values({
      id: STATE_ID,
      lastScrapeAt: null,
      nextScrapeAt: firstScrape,
      lastNotifyAt: null,
      nextNotifyAt: null,
      updatedAt: now,
    });
    lastScrapeAt = null;
    nextScrapeAt = firstScrape;
    lastNotifyAt = null;
    log("Scheduler", `initialized (first scrape ${firstScrape.toISOString()})`);
    return;
  }

  const row = rows[0];
  lastScrapeAt = row.lastScrapeAt ? new Date(row.lastScrapeAt) : null;
  nextScrapeAt = row.nextScrapeAt ? new Date(row.nextScrapeAt) : null;
  lastNotifyAt = row.lastNotifyAt ? new Date(row.lastNotifyAt) : null;

  const now = new Date();
  let dirty = false;

  if (!nextScrapeAt) {
    if (lastScrapeAt) {
      nextScrapeAt = new Date(lastScrapeAt.getTime() + scrapIntervalMs());
    } else {
      nextScrapeAt = new Date(now.getTime() + 30_000);
    }
    dirty = true;
  }

  if (dirty) await persistState(db);

  log(
    "Scheduler",
    `restored nextScrape=${nextScrapeAt.toISOString()}` +
      (lastScrapeAt ? ` lastScrape=${lastScrapeAt.toISOString()}` : " (never scraped)") +
      " · notify=after each scrape",
  );
}

async function persistState(db: Database): Promise<void> {
  const now = new Date();
  await db
    .insert(schedulerState)
    .values({
      id: STATE_ID,
      lastScrapeAt,
      nextScrapeAt,
      lastNotifyAt,
      nextNotifyAt: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schedulerState.id,
      set: {
        lastScrapeAt,
        nextScrapeAt,
        lastNotifyAt,
        nextNotifyAt: null,
        updatedAt: now,
      },
    });
}

async function markScrapeFinished(db: Database): Promise<void> {
  const now = new Date();
  lastScrapeAt = now;
  nextScrapeAt = new Date(now.getTime() + scrapIntervalMs());
  await persistState(db);
  log("Scheduler", `next scrape at ${nextScrapeAt.toISOString()}`);
}

export function getSchedulerStatus() {
  return {
    scrapIntervalMinutes: env.scrapIntervalMinutes,
    /** @deprecated notify is post-scrape, not clock-based */
    notifyHour: env.notifyHour,
    nextScrapeAt: nextScrapeAt?.toISOString() ?? null,
    nextNotifyAt: null as string | null,
    notifyMode: "after_scrape" as const,
    lastScrapeAt: lastScrapeAt?.toISOString() ?? null,
    lastNotifyAt: lastNotifyAt?.toISOString() ?? null,
    scraperStartedAt: processStartedAt.toISOString(),
    scrapeInProgress: scraping,
    scrapeProgress: scraping ? scrapeProgress : null,
  };
}

/**
 * Apply a new scrape interval in-memory and reschedule the next run.
 * Caller is responsible for persisting the setting to the DB.
 */
export async function applyScrapIntervalMinutes(
  db: Database,
  minutes: number,
): Promise<{ scrapIntervalMinutes: number; nextScrapeAt: string | null }> {
  const clamped = Math.max(1, Math.floor(minutes));
  env.scrapIntervalMinutes = clamped;

  const now = Date.now();
  if (lastScrapeAt) {
    nextScrapeAt = new Date(lastScrapeAt.getTime() + scrapIntervalMs());
    // If the new interval makes the next run overdue, fire soon (not immediately mid-request storm)
    if (nextScrapeAt.getTime() <= now) {
      nextScrapeAt = new Date(now + 15_000);
    }
  } else {
    nextScrapeAt = new Date(now + scrapIntervalMs());
  }

  await persistState(db);
  log(
    "Scheduler",
    `scrap interval set to ${clamped}m · next scrape ${nextScrapeAt.toISOString()}`,
  );

  return {
    scrapIntervalMinutes: clamped,
    nextScrapeAt: nextScrapeAt.toISOString(),
  };
}

export async function startScheduler(db: Database): Promise<void> {
  await loadState(db);

  tickTimer = setInterval(() => {
    void tick(db);
  }, 15_000);

  void tick(db);

  log(
    "Processor",
    `live (scrap every ${env.scrapIntervalMinutes}m, notify after each scrape, schedule persisted)`,
  );
}

async function tick(db: Database): Promise<void> {
  const now = new Date();

  if (nextScrapeAt && now.getTime() >= nextScrapeAt.getTime() && !scraping) {
    try {
      await scrapAll(db);
    } catch (err) {
      logError("Processor", String(err));
    }
  }
}

export function stopScheduler(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

/** Always fire notify after a scrape finishes (success, incomplete, or error). */
async function notifyScrapeDone(db: Database, scrapeStatus: string): Promise<void> {
  try {
    const sent = await notifyAfterScrape(db, scrapeStatus);
    lastNotifyAt = new Date();
    await persistState(db);
    log("Notify", `post-scrape notify done (status=${scrapeStatus}, events=${sent})`);
  } catch (err) {
    logError("Notify", `post-scrape notify failed: ${err}`);
  }
}

/** True while a scrape job is running (scheduler or manual). */
export function isScraping(): boolean {
  return scraping;
}

/**
 * Kick off a full scrape in the background and return immediately.
 * Use from HTTP handlers so the client is not blocked for the whole run.
 */
export function startScrapAll(db: Database): {
  started: boolean;
  alreadyRunning: boolean;
} {
  if (scraping) {
    log("Processor", "scrape already running — not starting another");
    return { started: false, alreadyRunning: true };
  }

  log("Processor", "starting scrape in background");
  void scrapAll(db).catch((err) => {
    logError("Processor", `background scrape failed: ${err}`);
  });

  return { started: true, alreadyRunning: false };
}

export async function scrapAll(db: Database): Promise<{ found: number; runId: number }> {
  if (scraping) {
    log("Processor", "scrape already running, skip");
    return { found: 0, runId: -1 };
  }

  scraping = true;
  const startedAt = new Date().toISOString();
  setProgress({
    phase: "starting",
    message: "Starting scrape run…",
    runId: null,
    routineIndex: null,
    routinesTotal: null,
    engineSlug: null,
    engineName: null,
    routineLabel: null,
    listingsSeen: 0,
    detailsIndex: null,
    detailsTotal: null,
    startedAt,
  });

  const [run] = await db
    .insert(scrapeRuns)
    .values({ status: "running" })
    .returning();

  setProgress({
    phase: "starting",
    message: `Run #${run.id} — loading routines…`,
    runId: run.id,
    startedAt,
  });

  let totalSightings = 0;
  let totalSeen = 0;
  let routinesComplete = 0;
  let anyIncomplete = false;
  let finalStatus = "error";

  try {
    const allRoutines = await db
      .select()
      .from(searchRoutines)
      .where(eq(searchRoutines.enabled, true));

    await db
      .update(scrapeRuns)
      .set({ routinesTotal: allRoutines.length })
      .where(eq(scrapeRuns.id, run.id));

    setProgress({
      phase: "starting",
      message:
        allRoutines.length === 0
          ? "No enabled routines — finishing…"
          : `Run #${run.id} · ${allRoutines.length} routine${allRoutines.length === 1 ? "" : "s"}`,
      runId: run.id,
      routinesTotal: allRoutines.length,
      listingsSeen: 0,
    });

    let routineStep = 0;
    for (const routine of allRoutines) {
      routineStep++;
      const engine = findEngineById(routine.engineId);
      if (!engine) {
        logError("Processor", `unknown engine id ${routine.engineId}`);
        anyIncomplete = true;
        continue;
      }

      const config: Record<string, unknown> = {
        engine: routine.engineId,
        ...routine.config,
      };
      const label = routineLabelFromConfig(config);
      const where = label ? ` · ${label}` : "";

      setProgress({
        phase: "routine",
        message: `Routine ${routineStep}/${allRoutines.length}: scraping ${engine.name}${where}`,
        runId: run.id,
        routineIndex: routineStep,
        routinesTotal: allRoutines.length,
        engineSlug: engine.slug,
        engineName: engine.name,
        routineLabel: label,
        listingsSeen: totalSeen,
      });

      const result = await runScrapeJob({
        engine: engine.slug,
        routine: config,
      });

      const normalized = {
        ...result,
        complete: result.complete === true && result.ok,
        pagesPlanned: result.pagesPlanned ?? 0,
        pagesFetched: result.pagesFetched ?? (result.ok ? 1 : 0),
        pagesFailed: result.pagesFailed ?? (result.ok ? 0 : 1),
        items: result.items ?? [],
      };

      if (!normalized.ok) {
        logError(
          "Scrap",
          `/${engine.name}->${String(config.keywords ?? "")}/ error: ${normalized.error}`,
        );
        anyIncomplete = true;
      }

      setProgress({
        phase: "routine",
        message: `Routine ${routineStep}/${allRoutines.length}: saving ${engine.name}${where} (${normalized.items.length} items)`,
        runId: run.id,
        routineIndex: routineStep,
        routinesTotal: allRoutines.length,
        engineSlug: engine.slug,
        engineName: engine.name,
        routineLabel: label,
        listingsSeen: totalSeen,
      });

      const ingest = await ingestRoutineScrape(db, {
        scrapeRunId: run.id,
        searchRoutineId: routine.id,
        engineSlug: engine.slug,
        result: normalized,
      });

      totalSightings += ingest.sightingsCreated;
      totalSeen += ingest.itemsSeen;
      if (ingest.complete) routinesComplete++;
      else anyIncomplete = true;

      setProgress({
        phase: "routine",
        message: `Routine ${routineStep}/${allRoutines.length} done: ${engine.name}${where} · ${ingest.itemsSeen} listings`,
        listingsSeen: totalSeen,
      });

      log(
        "Scrap",
        `/${engine.name}->${String(config.keywords ?? "")}/ seen=${ingest.itemsSeen} complete=${ingest.complete}`,
      );
    }

    // Special job: one-time item-page scrapes for listings missing details
    try {
      setProgress({
        phase: "details",
        message: "Checking listings that need item-page details…",
        runId: run.id,
        routinesTotal: allRoutines.length,
        listingsSeen: totalSeen,
        detailsIndex: null,
        detailsTotal: null,
      });

      const detailsJob = await runItemDetailsJob(db, run.id, (info) => {
        const shortName =
          info.name.length > 48 ? `${info.name.slice(0, 45)}…` : info.name;
        setProgress({
          phase: "details",
          message: `Item details ${info.index}/${info.total}: ${info.engineSlug} · ${shortName}`,
          runId: run.id,
          listingsSeen: totalSeen,
          detailsIndex: info.index,
          detailsTotal: info.total,
          engineSlug: info.engineSlug,
          engineName: info.engineSlug,
          routineLabel: shortName,
        });
      });
      if (!detailsJob.complete) anyIncomplete = true;
      if (detailsJob.planned > 0) {
        setProgress({
          phase: "details",
          message: `Item details finished: ${detailsJob.fetched} ok, ${detailsJob.failed} failed`,
          detailsIndex: detailsJob.planned,
          detailsTotal: detailsJob.planned,
          listingsSeen: totalSeen,
        });
      }
      log(
        "Processor",
        `item-details job planned=${detailsJob.planned} ok=${detailsJob.fetched} failed=${detailsJob.failed}`,
      );
    } catch (err) {
      anyIncomplete = true;
      logError("Processor", `item-details job failed: ${err}`);
    }

    setProgress({
      phase: "finishing",
      message: `Finishing run #${run.id} · ${totalSeen} listings seen…`,
      runId: run.id,
      listingsSeen: totalSeen,
    });

    finalStatus =
      allRoutines.length === 0 && totalSeen === 0
        ? "done"
        : anyIncomplete
          ? "incomplete"
          : "done";

    await db
      .update(scrapeRuns)
      .set({
        status: finalStatus,
        finishedAt: new Date(),
        listingsFound: totalSeen,
        sightingsCreated: totalSightings,
        routinesComplete,
      })
      .where(eq(scrapeRuns.id, run.id));

    await markScrapeFinished(db);

    log(
      "Processor",
      `scraping finished status=${finalStatus} seen=${totalSeen} sightings=${totalSightings} completeRoutines=${routinesComplete}/${allRoutines.length}`,
    );
    return { found: totalSightings, runId: run.id };
  } catch (err) {
    finalStatus = "error";
    setProgress({
      phase: "finishing",
      message: `Run failed: ${String(err).slice(0, 120)}`,
      runId: run.id,
      listingsSeen: totalSeen,
    });
    await db
      .update(scrapeRuns)
      .set({
        status: "error",
        finishedAt: new Date(),
        error: String(err),
        listingsFound: totalSeen,
        sightingsCreated: totalSightings,
        routinesComplete,
      })
      .where(eq(scrapeRuns.id, run.id));
    await markScrapeFinished(db);
    throw err;
  } finally {
    setProgress({
      phase: "notify",
      message: "Sending notifications…",
      runId: run.id,
      listingsSeen: totalSeen,
    });
    // Always notify after scrape ends (success or failure)
    await notifyScrapeDone(db, finalStatus);
    scraping = false;
    scrapeProgress = idleProgress();
  }
}

export function getEngines() {
  return ENGINES.map((e) => ({
    id: e.id,
    slug: e.slug,
    name: e.name,
    options: e.options,
    itemFields: e.itemFields,
  }));
}
