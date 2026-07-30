import { Hono } from "hono";
import { desc, sql } from "drizzle-orm";
import { scrapeRuns, type Database } from "@watcher/db";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { getEngines, getSchedulerStatus, startScrapAll } from "../services/processor";
import { notifyAll, transportsStatus } from "../services/notify";
import { scraperHealth } from "../services/scraper-client";
import { countSubscriptions, isPushConfigured } from "../services/push";
import { log } from "../lib/time";
import { ENGINES } from "@watcher/shared";

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

  /** Full status dashboard payload */
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
      .limit(30);

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
      runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        listingsFound: r.listingsFound,
        routinesTotal: r.routinesTotal,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        error: r.error,
      })),
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
    const rows = await db
      .select()
      .from(scrapeRuns)
      .orderBy(desc(scrapeRuns.startedAt))
      .limit(30);
    return c.json(
      rows.map((r) => ({
        id: r.id,
        status: r.status,
        itemsFound: r.listingsFound,
        listingsFound: r.listingsFound,
        routinesTotal: r.routinesTotal,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        error: r.error,
      })),
    );
  });

  return app;
}
