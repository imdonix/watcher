import { eq } from "drizzle-orm";
import { listingEvents, listings, type Database } from "@watcher/db";
import { dateOnly, log } from "../lib/time";
import { isPushConfigured, sendPushToAll } from "./push";

/** Only brand-new listings warrant a push. */
const NOTIFY_KINDS = ["first_seen"] as const;

/**
 * Push only for new listings (first_seen). Other unnotified events
 * (missing, price_change, reappeared) are marked handled without a push.
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

  const toNotify = pending.filter((p) =>
    (NOTIFY_KINDS as readonly string[]).includes(p.event.kind),
  );
  const toSilence = pending.filter(
    (p) => !(NOTIFY_KINDS as readonly string[]).includes(p.event.kind),
  );

  // Drain non-notify events so they never surface as "findings"
  for (const { event } of toSilence) {
    await db
      .update(listingEvents)
      .set({ notified: true })
      .where(eq(listingEvents.id, event.id));
  }
  if (toSilence.length > 0) {
    log(
      "Notify",
      `post-scrape (${scrapeStatus}) — silenced ${toSilence.length} non-new event(s)`,
    );
  }

  const n = toNotify.length;
  if (n === 0) {
    log("Notify", `post-scrape (${scrapeStatus}) — no new listings, skip push`);
    return 0;
  }

  // Single line of info — no branded title (SW shows body as the notification text)
  const message =
    n === 1 ? "1 new listing available" : `${n} new listings available`;
  log("Notify", `post-scrape (${scrapeStatus}) — ${message}`);

  const pushOk = await sendPushToAll(db, {
    title: "",
    body: message,
    url: "/listings",
    tag: `watcher-${dateOnly()}`,
    count: n,
  });

  for (const { event } of toNotify) {
    await db
      .update(listingEvents)
      .set({ notified: true })
      .where(eq(listingEvents.id, event.id));
  }

  log("Notify", `done: ${n} new listing(s) marked, push→${pushOk} device(s)`);
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
