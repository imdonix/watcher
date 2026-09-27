import { Hono } from "hono";
import { inArray } from "drizzle-orm";
import { listings, searchRoutines, type Database } from "@watcher/db";
import { findEngineById } from "@watcher/shared";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { log } from "../lib/time";

type RoutineRow = typeof searchRoutines.$inferSelect;

/** Engine ids whose set of AI prompts differs between two routine snapshots. */
function changedPromptEngines(before: RoutineRow[], after: RoutineRow[]): number[] {
  const signatures = (rows: RoutineRow[]): Map<number, string> => {
    const map = new Map<number, string[]>();
    for (const row of rows) {
      const prompt = String(row.config?.aiPrompt ?? "").trim();
      if (!prompt) continue;
      const list = map.get(row.engineId) ?? [];
      list.push(prompt);
      map.set(row.engineId, list);
    }
    return new Map([...map].map(([id, prompts]) => [id, [...prompts].sort().join("\n---\n")]));
  };

  const beforeMap = signatures(before);
  const afterMap = signatures(after);
  const engineIds = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  return [...engineIds].filter((id) => beforeMap.get(id) !== afterMap.get(id));
}

export function routineRoutes(db: Database) {
  const app = new Hono<AuthEnv>();

  app.use("*", requireAuth);

  app.get("/", async (c) => {
    const rows = await db.select().from(searchRoutines);
    log("API", `Download routines (${rows.length})`);

    const data = rows.map((r) => ({
      ...r.config,
      engine: r.engineId,
      _id: r.id,
      enabled: r.enabled,
    }));
    return c.json(data);
  });

  app.post("/download", async (c) => {
    const rows = await db.select().from(searchRoutines);
    log("API", `Download routines (${rows.length})`);
    return c.json(
      rows.map((r) => ({
        ...r.config,
        engine: r.engineId,
        _id: r.id,
        enabled: r.enabled,
      })),
    );
  });

  app.post("/upload", async (c) => {
    const body = await c.req.json<{ data?: Record<string, unknown>[] }>();
    const list = body.data ?? [];

    log("API", `Upload routines (${list.length})`);

    const before = await db.select().from(searchRoutines);
    await db.delete(searchRoutines);

    for (const raw of list) {
      const engineId = Number(raw.engine);
      if (!Number.isFinite(engineId)) continue;

      const { engine: _e, _id, enabled, ...rest } = raw as Record<string, unknown> & {
        engine?: number;
        _id?: number;
        enabled?: boolean;
      };

      await db.insert(searchRoutines).values({
        engineId,
        config: rest,
        enabled: enabled !== false,
        updatedAt: new Date(),
      });
    }

    // AI verdicts depend on the routine prompt — drop them where prompts changed
    // so listings get re-evaluated on the next run.
    const after = await db.select().from(searchRoutines);
    const changedEngineIds = changedPromptEngines(before, after);
    if (changedEngineIds.length > 0) {
      const slugs = changedEngineIds
        .map((id) => findEngineById(id)?.slug)
        .filter((s): s is string => Boolean(s));
      if (slugs.length > 0) {
        await db
          .update(listings)
          .set({
            aiVerdict: null,
            aiReason: null,
            aiModel: null,
            aiEvaluatedAt: null,
            updatedAt: new Date(),
          })
          .where(inArray(listings.engineSlug, slugs));
        log("API", `AI verdicts cleared for engine(s) ${slugs.join(", ")} (prompt changed)`);
      }
    }

    return c.json({ ok: true, count: list.length });
  });

  return app;
}
