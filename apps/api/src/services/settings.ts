import { eq } from "drizzle-orm";
import { settings, type Database } from "@watcher/db";
import { env } from "../env";
import { log } from "../lib/time";

export type SettingType = "string" | "number" | "boolean" | "json";

export const SETTING_KEYS = {
  apiToken: "api_token",
  scrapIntervalMinutes: "scrap_interval_minutes",
  aiEnabled: "ai_enabled",
  aiBaseUrl: "ai_base_url",
  aiApiKey: "ai_api_key",
  aiModel: "ai_model",
  aiPassThreshold: "ai_pass_threshold",
} as const;

/** Allowed scrape interval range (minutes). */
export const SCRAP_INTERVAL_MIN = 1;
export const SCRAP_INTERVAL_MAX = 24 * 60; // 1 day

/** AI evaluation defaults (Ollama-compatible endpoint; cloud by default). */
export const AI_DEFAULT_BASE_URL = "https://ollama.com";
export const AI_DEFAULT_MODEL = "gemma4:31b";
/** Score >= threshold counts as pass. */
export const AI_DEFAULT_PASS_THRESHOLD = 65;

export async function getSetting(
  db: Database,
  key: string,
): Promise<{ type: string; value: string } | null> {
  const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  if (rows.length === 0) return null;
  return { type: rows[0].type, value: rows[0].value };
}

export async function setSetting(
  db: Database,
  key: string,
  type: SettingType,
  value: string,
): Promise<void> {
  await db
    .insert(settings)
    .values({
      key,
      type,
      value,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        type,
        value,
        updatedAt: new Date(),
      },
    });
}

export async function getStringSetting(db: Database, key: string): Promise<string | null> {
  const row = await getSetting(db, key);
  return row?.value ?? null;
}

export async function getBooleanSetting(db: Database, key: string): Promise<boolean | null> {
  const row = await getSetting(db, key);
  if (!row) return null;
  if (row.value === "true" || row.value === "false") return row.value === "true";
  return null;
}

export async function getNumberSetting(db: Database, key: string): Promise<number | null> {
  const row = await getSetting(db, key);
  if (!row) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

export function clampScrapIntervalMinutes(raw: number): number {
  return Math.min(SCRAP_INTERVAL_MAX, Math.max(SCRAP_INTERVAL_MIN, Math.floor(raw)));
}

/**
 * Load runtime settings from DB after migrations.
 * Prefer persisted values; seed defaults from env when missing.
 */
export async function loadRuntimeSettings(db: Database): Promise<void> {
  const stored = await getNumberSetting(db, SETTING_KEYS.scrapIntervalMinutes);
  if (stored != null && stored >= SCRAP_INTERVAL_MIN) {
    env.scrapIntervalMinutes = clampScrapIntervalMinutes(stored);
    log("Settings", `scrap interval ${env.scrapIntervalMinutes}m (from settings table)`);
    return;
  }

  const seed = clampScrapIntervalMinutes(env.scrapIntervalMinutes);
  env.scrapIntervalMinutes = seed;
  await setSetting(db, SETTING_KEYS.scrapIntervalMinutes, "number", String(seed));
  log("Settings", `scrap interval ${seed}m (seeded from env/default)`);
}
