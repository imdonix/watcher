import { Hono } from "hono";
import { cors } from "hono/cors";
import { closeDb, createDb, runMigrations } from "@watcher/db";
import { env } from "./env";
import { log, logError } from "./lib/time";
import { startScheduler, stopScheduler } from "./services/processor";
import { resolveAndPersistApiToken } from "./services/api-token";
import { loadRuntimeSettings } from "./services/settings";
import { authRoutes } from "./routes/auth";
import { routineRoutes } from "./routes/routines";
import { itemRoutes } from "./routes/items";
import { jobRoutes } from "./routes/jobs";
import { pushRoutes } from "./routes/push";
import { settingsRoutes } from "./routes/settings";
import { initWebPush } from "./services/push";

async function waitForDb(attempts = 30) {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const client = await import("postgres").then((m) => m.default(env.databaseUrl, { max: 1 }));
      try {
        await client`SELECT 1`;
      } finally {
        await client.end({ timeout: 2 });
      }
      return;
    } catch (err) {
      last = err;
      log("DB", `waiting for postgres (${i + 1}/${attempts})...`);
      await Bun.sleep(2000);
    }
  }
  throw last;
}

/**
 * Print token to stderr at the end of boot so `bun run --filter` elision
 * (early stdout lines) does not hide it.
 */
function logApiToken(): void {
  const source =
    env.apiTokenSource === "env"
      ? "API_TOKEN env (synced to settings)"
      : env.apiTokenSource === "settings"
        ? "settings table (persisted)"
        : env.apiTokenSource === "generated"
          ? "generated + saved to settings"
          : "unknown";
  // stderr survives bun workspace log trimming better than multi-line stdout banners
  const lines = [
    "",
    ">>> WATCHER API TOKEN (login / Authorization: Bearer …) <<<",
    `>>> ${env.apiToken}`,
    `>>> source: ${source}`,
    "",
  ].join("\n");
  process.stderr.write(lines);
  console.log(`[Auth] API_TOKEN=${env.apiToken} (${source})`);
}

async function main() {
  await waitForDb();
  log("DB", "running Drizzle migrations…");
  await runMigrations(env.databaseUrl);
  log("DB", "migrations up to date");

  const db = createDb(env.databaseUrl);

  await resolveAndPersistApiToken(db);
  await loadRuntimeSettings(db);

  initWebPush();
  log("Notify", "transports: logger + web push");

  await startScheduler(db);

  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: env.corsOrigin.split(",").map((s) => s.trim()),
      allowHeaders: ["Content-Type", "Authorization", "X-API-Token"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );

  const auth = authRoutes();
  const routines = routineRoutes(db);
  const itemsApp = itemRoutes(db);
  const jobs = jobRoutes(db);
  const push = pushRoutes(db);
  const settingsApp = settingsRoutes(db);

  app.route("/auth", auth);
  app.route("/routines", routines);
  app.route("/items", itemsApp);
  app.route("/push", push);
  app.route("/settings", settingsApp);
  app.route("/", jobs);

  app.post("/login", (c) =>
    auth.fetch(
      new Request(`http://local/login`, {
        method: "POST",
        headers: c.req.raw.headers,
        body: c.req.raw.body,
      }),
    ),
  );
  app.post("/upload", (c) =>
    routines.fetch(
      new Request(`http://local/upload`, {
        method: "POST",
        headers: c.req.raw.headers,
        body: c.req.raw.body,
      }),
    ),
  );
  app.post("/download", (c) =>
    routines.fetch(
      new Request(`http://local/download`, {
        method: "POST",
        headers: c.req.raw.headers,
        body: c.req.raw.body,
      }),
    ),
  );
  app.post("/memory", (c) =>
    itemsApp.fetch(
      new Request(`http://local/memory`, {
        method: "POST",
        headers: c.req.raw.headers,
        body: c.req.raw.body,
      }),
    ),
  );

  const server = Bun.serve({
    port: env.port,
    fetch: app.fetch,
  });

  // Print last so it is not collapsed under "N lines elided"
  log("HTTP", `started on localhost:${env.port}`);
  logApiToken();

  // k8s sends SIGTERM on pod delete; without this Bun keeps the event loop
  // (serve + setInterval + postgres) until the grace period hard-kills us.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("HTTP", `${signal} received — shutting down`);

    // Hard cap so a stuck DB close cannot burn the whole terminationGracePeriod
    const forceTimer = setTimeout(() => {
      logError("HTTP", "shutdown timed out — force exit");
      process.exit(1);
    }, 8_000);
    // Don't keep the process alive only for this timer
    forceTimer.unref?.();

    try {
      stopScheduler();
      server.stop(true);
      await closeDb(db, 2);
    } catch (err) {
      logError("HTTP", `shutdown error: ${err}`);
    }
    clearTimeout(forceTimer);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logError("Fatal", String(err));
  process.exit(1);
});
