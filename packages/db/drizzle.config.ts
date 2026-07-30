import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config.
 *
 * Workflow:
 *   1. Edit `src/schema.ts`
 *   2. `bun run --filter @watcher/db generate`  → writes SQL under `drizzle/`
 *   3. Deploy / boot API (runs `runMigrations`) or `bun run --filter @watcher/db migrate`
 */
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://watcher:watcher@localhost:5432/watcher",
  },
  strict: true,
  verbose: true,
});
