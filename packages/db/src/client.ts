import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Sql = ReturnType<typeof postgres>;

const clients = new WeakMap<object, Sql>();

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 30,
  });
  const db = drizzle(client, { schema });
  clients.set(db, client);
  return db;
}

/** Close the underlying postgres pool (for process shutdown). */
export async function closeDb(db: Database, timeoutSeconds = 2): Promise<void> {
  const client = clients.get(db);
  if (!client) return;
  clients.delete(db);
  await client.end({ timeout: timeoutSeconds });
}
