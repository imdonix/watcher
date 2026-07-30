import webpush from "web-push";
import { eq } from "drizzle-orm";
import { webPushSubscriptions, type Database } from "@watcher/db";
import { env } from "../env";
import { log, logError } from "../lib/time";

let configured = false;

export function initWebPush(): void {
  if (!env.vapid.publicKey || !env.vapid.privateKey) {
    logError("Push", "VAPID keys missing — web push disabled");
    return;
  }
  webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey);
  configured = true;
  log("Push", "Web Push (VAPID) configured");
}

export function isPushConfigured(): boolean {
  return configured;
}

export function getVapidPublicKey(): string {
  return env.vapid.publicKey;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function saveSubscription(
  db: Database,
  sub: PushSubscriptionInput,
  userAgent?: string,
): Promise<void> {
  await db
    .insert(webPushSubscriptions)
    .values({
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: userAgent ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: webPushSubscriptions.endpoint,
      set: {
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent: userAgent ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function removeSubscription(db: Database, endpoint: string): Promise<void> {
  await db.delete(webPushSubscriptions).where(eq(webPushSubscriptions.endpoint, endpoint));
}

export async function countSubscriptions(db: Database): Promise<number> {
  const rows = await db
    .select({ endpoint: webPushSubscriptions.endpoint })
    .from(webPushSubscriptions);
  return rows.length;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  count?: number;
}

export async function sendPushToAll(db: Database, payload: PushPayload): Promise<number> {
  if (!configured) {
    log("Push", "skip send — VAPID not configured");
    return 0;
  }

  const rows = await db.select().from(webPushSubscriptions);
  if (rows.length === 0) {
    log("Push", "no subscribers");
    return 0;
  }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/listings",
    tag: payload.tag ?? "watcher-deals",
    count: payload.count,
  });

  let ok = 0;
  for (const row of rows) {
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    };
    try {
      await webpush.sendNotification(subscription, body, {
        TTL: 60 * 60,
        urgency: "normal",
      });
      ok++;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      logError("Push", `send failed (${status ?? "?"}): ${err}`);
      if (status === 404 || status === 410) {
        await removeSubscription(db, row.endpoint);
        log("Push", `removed dead subscription`);
      }
    }
  }

  log("Push", `delivered to ${ok}/${rows.length} subscription(s)`);
  return ok;
}
