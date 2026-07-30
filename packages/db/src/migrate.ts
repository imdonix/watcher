import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to packages/db/drizzle (SQL migrations from drizzle-kit) */
export function migrationsFolder(): string {
  return resolve(__dirname, "../drizzle");
}

type Journal = {
  entries: Array<{ tag: string; when: number }>;
};

/**
 * If the app schema was created via `db:push` / old bootstrap but Drizzle has no
 * migration history, record existing migration files as applied so `migrate()`
 * does not try to CREATE TABLE again.
 */
async function baselineIfSchemaAlreadyExists(
  client: postgres.Sql,
  folder: string,
): Promise<boolean> {
  const [{ exists: hasListings }] = await client<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'listings'
    ) AS exists
  `;

  if (!hasListings) return false;

  await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await client`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;

  const existing = await client<{ n: string }[]>`
    SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations
  `;
  if (Number(existing[0]?.n ?? 0) > 0) {
    // History present — let migrate handle remaining files
    return false;
  }

  const journalPath = resolve(folder, "meta/_journal.json");
  if (!existsSync(journalPath)) {
    throw new Error(`Missing ${journalPath}`);
  }
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;

  for (const entry of journal.entries) {
    const sqlPath = resolve(folder, `${entry.tag}.sql`);
    const query = readFileSync(sqlPath, "utf8");
    // Must match drizzle-orm/migrator.js: sha256 of full file contents
    const hash = createHash("sha256").update(query).digest("hex");
    await client`
      INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at")
      VALUES (${hash}, ${entry.when})
    `;
    console.log(`[db] baselined migration ${entry.tag} (schema already present)`);
  }

  return true;
}

/**
 * Apply all pending Drizzle Kit migrations against DATABASE_URL (or provided url).
 * Safe to call on every API boot.
 *
 * Handles the common case where tables already exist from `drizzle-kit push`
 * or an older bootstrap without a migration journal.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const folder = migrationsFolder();
  const client = postgres(connectionString, { max: 1 });
  try {
    await baselineIfSchemaAlreadyExists(client, folder);
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await client.end({ timeout: 5 });
  }
}

// CLI: `bun run packages/db/src/migrate.ts` or workspace script
if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  console.log(`Running migrations from ${migrationsFolder()}`);
  runMigrations(url)
    .then(() => {
      console.log("Migrations complete");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
