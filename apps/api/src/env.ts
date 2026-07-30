function num(v: string | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: string | undefined, fallback = ""): string {
  return v ?? fallback;
}

/** Generate a cryptographically strong API token when none is configured. */
export function generateApiToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type ApiTokenSource = "env" | "settings" | "generated" | "unset";

/**
 * Default VAPID pair for Docker / first boot (replace in production).
 * Override with VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY.
 */
const DEFAULT_VAPID_PUBLIC =
  "BBYrfVsKv1tXaJZhF693BxVf6LkrgfaNvA8PmBYPvRhHJ9sQzyOoe6mQses823tHcPhuAd67Cy80vrqgNeJ-KgM";
const DEFAULT_VAPID_PRIVATE = "Ifk6LEVJHQEKUycZdKJNSgLAjSDFzeQ9T6DQiu4KsGk";

/** Mutable runtime config (apiToken filled after DB resolve). */
export const env = {
  port: num(process.env.API_PORT, 3000),
  databaseUrl: str(
    process.env.DATABASE_URL,
    "postgresql://watcher:watcher@localhost:5432/watcher",
  ),
  /**
   * Bearer token for protected endpoints.
   * Set after `resolveApiToken()` (env → settings → generate+persist).
   */
  apiToken: "",
  apiTokenSource: "unset" as ApiTokenSource,
  /** Raw env override if present (checked before DB). */
  apiTokenEnv: str(process.env.API_TOKEN).trim(),
  scrapIntervalMinutes: num(process.env.SCRAP_INTERVAL_MINUTES, 5),
  notifyHour: num(process.env.NOTIFY_HOUR, 8),
  corsOrigin: str(process.env.CORS_ORIGIN, "http://localhost:5173"),
  scraperUrl: str(process.env.SCRAPER_URL, "http://localhost:3001"),
  vapid: {
    publicKey: str(process.env.VAPID_PUBLIC_KEY, DEFAULT_VAPID_PUBLIC),
    privateKey: str(process.env.VAPID_PRIVATE_KEY, DEFAULT_VAPID_PRIVATE),
    subject: str(process.env.VAPID_SUBJECT, "mailto:watcher@localhost"),
  },
};

export function setRuntimeApiToken(token: string, source: ApiTokenSource): void {
  env.apiToken = token;
  env.apiTokenSource = source;
}

/** Constant-time string compare for API tokens */
export function tokensMatch(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) {
    let diff = a.length ^ b.length;
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
    }
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}
