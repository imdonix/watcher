import { eq } from "drizzle-orm";
import { listingEvents, listings, type Database } from "@watcher/db";
import { dateOnly, log } from "../lib/time";
import { isPushConfigured, sendPushToAll } from "./push";

/**
 * Mark pending events notified and push a short summary.
 * Always sends a push after scrape (even when count is 0).
 */
export async function notifyAfterScrape(
  db: Database,
  scrapeStatus: string,
): Promise<number> {
  const pending = await db
    .select({
      event: listingEvents,
      listing: listings,
    })
    .from(listingEvents)
    .innerJoin(listings, eq(listingEvents.listingId, listings.id))
    .where(eq(listingEvents.notified, false));

  const n = pending.length;
  if (n === 0) {
    log("Notify", `post-scrape (${scrapeStatus}) — no new findings, skip push`);
    return 0;
  }

  const message = `Found ${n} new finding${n === 1 ? "" : "s"}.`;
  log("Notify", `post-scrape (${scrapeStatus}) — ${message}`);

  const pushOk = await sendPushToAll(db, {
    title: "Watcher",
    body: message,
    url: "/listings",
    tag: `watcher-${dateOnly()}`,
    count: n,
  });

  for (const { event } of pending) {
    await db
      .update(listingEvents)
      .set({ notified: true })
      .where(eq(listingEvents.id, event.id));
  }

  log("Notify", `done: ${n} event(s) marked, push→${pushOk} device(s)`);
  return n;
}

/** Manual notify (same behaviour: flush pending events + push summary). */
export async function notifyAll(db: Database): Promise<number> {
  return notifyAfterScrape(db, "manual");
}

export function transportsStatus() {
  return {
    logger: true,
    push: isPushConfigured(),
  };
}
