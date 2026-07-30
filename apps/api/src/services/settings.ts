import { eq } from "drizzle-orm";
import { settings, type Database } from "@watcher/db";

export type SettingType = "string" | "number" | "boolean" | "json";

export const SETTING_KEYS = {
  apiToken: "api_token",
} as const;

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
