import { eq } from "drizzle-orm";
import {
  schedulerState,
  searchRoutines,
  scrapeRuns,
  type Database,
} from "@watcher/db";
import { ENGINES, findEngineById } from "@watcher/shared";
import { env } from "../env";
import { log, logError } from "../lib/time";
import { runScrapeJob } from "./scraper-client";
import { notifyAfterScrape } from "./notify";
import { ingestRoutineScrape } from "./listing-ingest";

const STATE_ID = 1;

let tickTimer: ReturnType<typeof setInterval> | null = null;
let scraping = false;

const processStartedAt = new Date();
let lastScrapeAt: Date | null = null;
let nextScrapeAt: Date | null = null;
let lastNotifyAt: Date | null = null;

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

export async function scrapAll(db: Database): Promise<{ found: number; runId: number }> {
  if (scraping) {
    log("Processor", "scrape already running, skip");
    return { found: 0, runId: -1 };
  }

  scraping = true;
  const [run] = await db
    .insert(scrapeRuns)
    .values({ status: "running" })
    .returning();

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

    for (const routine of allRoutines) {
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

      log(
        "Scrap",
        `/${engine.name}->${String(config.keywords ?? "")}/ seen=${ingest.itemsSeen} complete=${ingest.complete}`,
      );
    }

    finalStatus =
      allRoutines.length === 0 ? "done" : anyIncomplete ? "incomplete" : "done";

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
    scraping = false;
    // Always notify after scrape ends (success or failure)
    await notifyScrapeDone(db, finalStatus);
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
