import { Hono } from "hono";
import type { Database } from "@watcher/db";
import { requireAuth, type AuthEnv } from "../middleware/auth";
import {
  getVapidPublicKey,
  isPushConfigured,
  removeSubscription,
  saveSubscription,
  countSubscriptions,
} from "../services/push";
import { log } from "../lib/time";

export function pushRoutes(db: Database) {
  const app = new Hono<AuthEnv>();

  /** Public — browser needs this before subscribe */
  app.get("/vapid-public-key", (c) => {
    if (!isPushConfigured()) {
      return c.json({ error: "Push not configured" }, 503);
    }
    return c.json({ publicKey: getVapidPublicKey() });
  });

  app.get("/status", requireAuth, async (c) => {
    return c.json({
      configured: isPushConfigured(),
      subscribers: await countSubscriptions(db),
    });
  });

  app.post("/subscribe", requireAuth, async (c) => {
    const body = await c.req.json<{
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    }>();

    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return c.json({ error: "Invalid subscription" }, 400);
    }

    await saveSubscription(
      db,
      {
        endpoint: body.endpoint,
        keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
      },
      c.req.header("User-Agent") ?? undefined,
    );

    log("Push", "subscription saved");
    return c.json({ ok: true });
  });

  app.post("/unsubscribe", requireAuth, async (c) => {
    const body = await c.req.json<{ endpoint?: string }>();
    if (!body.endpoint) {
      return c.json({ error: "endpoint required" }, 400);
    }
    await removeSubscription(db, body.endpoint);
    log("Push", "subscription removed");
    return c.json({ ok: true });
  });

  return app;
}
