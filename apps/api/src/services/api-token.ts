import type { Database } from "@watcher/db";
import { env, generateApiToken, setRuntimeApiToken } from "../env";
import { log } from "../lib/time";
import { getStringSetting, setSetting, SETTING_KEYS } from "./settings";

/**
 * Resolve API token after DB is ready:
 * 1. `API_TOKEN` env → use it and upsert into settings (keeps DB in sync)
 * 2. else settings.api_token → use stored value
 * 3. else generate once, persist to settings, use it
 */
export async function resolveAndPersistApiToken(db: Database): Promise<void> {
  if (env.apiTokenEnv) {
    setRuntimeApiToken(env.apiTokenEnv, "env");
    await setSetting(db, SETTING_KEYS.apiToken, "string", env.apiTokenEnv);
    log("Auth", "API token from API_TOKEN env (synced to settings)");
    return;
  }

  const stored = await getStringSetting(db, SETTING_KEYS.apiToken);
  if (stored && stored.length > 0) {
    setRuntimeApiToken(stored, "settings");
    log("Auth", "API token loaded from settings table");
    return;
  }

  const token = generateApiToken();
  await setSetting(db, SETTING_KEYS.apiToken, "string", token);
  setRuntimeApiToken(token, "generated");
  log("Auth", "API token generated and persisted to settings");
}
