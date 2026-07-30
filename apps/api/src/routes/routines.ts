import { Hono } from "hono";
import { searchRoutines, type Database } from "@watcher/db";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import { log } from "../lib/time";

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

    return c.json({ ok: true, count: list.length });
  });

  return app;
}
