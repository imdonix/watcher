import { Hono } from "hono";
import type { Database } from "@watcher/db";
import { env } from "../env";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { applyScrapIntervalMinutes, getSchedulerStatus } from "../services/processor";
import { loadAiConfig, testAiConnection } from "../services/ai";
import {
  clampScrapIntervalMinutes,
  SCRAP_INTERVAL_MAX,
  SCRAP_INTERVAL_MIN,
  setSetting,
  SETTING_KEYS,
} from "../services/settings";
import { log } from "../lib/time";

async function readSettings(db: Database) {
  const scheduler = getSchedulerStatus();
  const ai = await loadAiConfig(db);
  return {
    scrapIntervalMinutes: env.scrapIntervalMinutes,
    scrapIntervalMin: SCRAP_INTERVAL_MIN,
    scrapIntervalMax: SCRAP_INTERVAL_MAX,
    nextScrapeAt: scheduler.nextScrapeAt,
    lastScrapeAt: scheduler.lastScrapeAt,
    aiEnabled: ai.enabled,
    aiBaseUrl: ai.baseUrl,
    aiApiKey: ai.apiKey,
    aiModel: ai.model,
    aiPassThreshold: ai.passThreshold,
  };
}

export function settingsRoutes(db: Database) {
  const app = new Hono<AuthEnv>();

  app.use("*", requireAuth);

  app.get("/", async (c) => {
    return c.json(await readSettings(db));
  });

  app.put("/", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      scrapIntervalMinutes?: unknown;
      aiEnabled?: unknown;
      aiBaseUrl?: unknown;
      aiApiKey?: unknown;
      aiModel?: unknown;
      aiPassThreshold?: unknown;
    };

    const hasScrap = body.scrapIntervalMinutes !== undefined;
    const hasAi =
      body.aiEnabled !== undefined ||
      body.aiBaseUrl !== undefined ||
      body.aiApiKey !== undefined ||
      body.aiModel !== undefined ||
      body.aiPassThreshold !== undefined;

    if (!hasScrap && !hasAi) {
      return c.json({ error: "No settings to update" }, 400);
    }

    if (hasScrap) {
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
      await applyScrapIntervalMinutes(db, minutes);
      log("API", `settings updated scrapIntervalMinutes=${minutes}`);
    }

    if (hasAi) {
      if (body.aiEnabled !== undefined) {
        if (typeof body.aiEnabled !== "boolean") {
          return c.json({ error: "aiEnabled must be a boolean" }, 400);
        }
        await setSetting(db, SETTING_KEYS.aiEnabled, "boolean", String(body.aiEnabled));
      }

      if (body.aiBaseUrl !== undefined) {
        if (typeof body.aiBaseUrl !== "string") {
          return c.json({ error: "aiBaseUrl must be a string" }, 400);
        }
        const url = body.aiBaseUrl.trim().replace(/\/+$/, "");
        if (url && !/^https?:\/\//i.test(url)) {
          return c.json({ error: "aiBaseUrl must start with http:// or https://" }, 400);
        }
        await setSetting(db, SETTING_KEYS.aiBaseUrl, "string", url);
      }

      if (body.aiApiKey !== undefined) {
        if (typeof body.aiApiKey !== "string") {
          return c.json({ error: "aiApiKey must be a string" }, 400);
        }
        await setSetting(db, SETTING_KEYS.aiApiKey, "string", body.aiApiKey.trim());
      }

      if (body.aiModel !== undefined) {
        if (typeof body.aiModel !== "string") {
          return c.json({ error: "aiModel must be a string" }, 400);
        }
        const model = body.aiModel.trim();
        if (!model) return c.json({ error: "aiModel cannot be empty" }, 400);
        await setSetting(db, SETTING_KEYS.aiModel, "string", model);
      }

      if (body.aiPassThreshold !== undefined) {
        const n = Number(body.aiPassThreshold);
        if (!Number.isInteger(n) || n < 0 || n > 100) {
          return c.json({ error: "aiPassThreshold must be an integer between 0 and 100" }, 400);
        }
        await setSetting(db, SETTING_KEYS.aiPassThreshold, "number", String(n));
      }

      log("API", "settings updated AI evaluation config");
    }

    return c.json(await readSettings(db));
  });

  /** Connectivity check — tests saved settings or the values in the request body. */
  app.post("/ai-test", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      aiBaseUrl?: unknown;
      aiApiKey?: unknown;
      aiModel?: unknown;
    };
    const saved = await loadAiConfig(db);
    const baseUrl =
      typeof body.aiBaseUrl === "string" && body.aiBaseUrl.trim()
        ? body.aiBaseUrl.trim().replace(/\/+$/, "")
        : saved.baseUrl;
    // Test with the typed key when present, otherwise the saved one.
    const apiKey =
      typeof body.aiApiKey === "string" && body.aiApiKey.trim()
        ? body.aiApiKey.trim()
        : saved.apiKey;
    const model =
      typeof body.aiModel === "string" && body.aiModel.trim()
        ? body.aiModel.trim()
        : saved.model;

    const result = await testAiConnection({
      enabled: true,
      baseUrl,
      apiKey,
      model,
      passThreshold: saved.passThreshold,
    });
    log("API", `AI connection test → ok=${result.ok} (${result.detail})`);
    return c.json({ ...result, model });
  });

  return app;
}
