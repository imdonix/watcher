import { Hono } from "hono";
import type { Database } from "@watcher/db";
import { env } from "../env";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { applyScrapIntervalMinutes, getSchedulerStatus } from "../services/processor";
import {
  clampScrapIntervalMinutes,
  SCRAP_INTERVAL_MAX,
  SCRAP_INTERVAL_MIN,
  setSetting,
  SETTING_KEYS,
} from "../services/settings";
import { log } from "../lib/time";

export function settingsRoutes(db: Database) {
  const app = new Hono<AuthEnv>();

  app.use("*", requireAuth);

  app.get("/", async (c) => {
    const scheduler = getSchedulerStatus();
    return c.json({
      scrapIntervalMinutes: env.scrapIntervalMinutes,
      scrapIntervalMin: SCRAP_INTERVAL_MIN,
      scrapIntervalMax: SCRAP_INTERVAL_MAX,
      nextScrapeAt: scheduler.nextScrapeAt,
      lastScrapeAt: scheduler.lastScrapeAt,
    });
  });

  app.put("/", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      scrapIntervalMinutes?: unknown;
    };

    if (body.scrapIntervalMinutes === undefined) {
      return c.json({ error: "No settings to update" }, 400);
    }

    const raw = Number(body.scrapIntervalMinutes);
    if (!Number.isFinite(raw)) {
      return c.json({ error: "scrapIntervalMinutes must be a number" }, 400);
    }

    if (raw < SCRAP_INTERVAL_MIN || raw > SCRAP_INTERVAL_MAX) {
      return c.json(
        {
          error: `scrapIntervalMinutes must be between ${SCRAP_INTERVAL_MIN} and ${SCRAP_INTERVAL_MAX}`,
        },
        400,
      );
    }

    const minutes = clampScrapIntervalMinutes(raw);
    await setSetting(db, SETTING_KEYS.scrapIntervalMinutes, "number", String(minutes));
    const applied = await applyScrapIntervalMinutes(db, minutes);
    log("API", `settings updated scrapIntervalMinutes=${minutes}`);

    return c.json({
      scrapIntervalMinutes: applied.scrapIntervalMinutes,
      scrapIntervalMin: SCRAP_INTERVAL_MIN,
      scrapIntervalMax: SCRAP_INTERVAL_MAX,
      nextScrapeAt: applied.nextScrapeAt,
      lastScrapeAt: getSchedulerStatus().lastScrapeAt,
    });
  });

  return app;
}
