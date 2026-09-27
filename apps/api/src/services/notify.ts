import { eq } from "drizzle-orm";
import { listingEvents, listings, type Database } from "@watcher/db";
import { formatPrice, type ListingEventKind } from "@watcher/shared";
import { dateOnly, log } from "../lib/time";
import { isPushConfigured, sendPushToAll } from "./push";

/** Events that surface as push notifications. Everything else is silenced. */
const NOTIFY_KINDS: readonly ListingEventKind[] = ["first_seen", "price_change", "target_hit"];

const MAX_ALERT_LINES = 3;
const NAME_MAX = 36;

function shortName(name: string): string {
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name;
}

function money(n: number | null): string {
  return n == null ? "—" : formatPrice(n);
}

/** One detail line for a non-new-listing alert. */
function alertLine(p: { event: typeof listingEvents.$inferSelect; listing: typeof listings.$inferSelect }): string {
  const name = shortName(p.listing.name);
  if (p.event.kind === "target_hit") {
    return p.event.oldPrice != null && p.event.oldPrice !== p.event.newPrice
      ? `Target hit · ${name} · ${money(p.event.oldPrice)} → ${money(p.event.newPrice)}`
      : `Target hit · ${name} · ${money(p.event.newPrice)}`;
  }
  return `↓ ${name} · ${money(p.event.oldPrice)} → ${money(p.event.newPrice)}`;
}

/**
 * Push for new listings (first_seen), price drops (price_change) and
 * target-price hits (target_hit). Other unnotified events (missing,
 * reappeared) are marked handled without a push.
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

  const kinds = NOTIFY_KINDS as readonly string[];
  const toNotify = pending.filter((p) => kinds.includes(p.event.kind));
  const toSilence = pending.filter((p) => !kinds.includes(p.event.kind));

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
      `post-scrape (${scrapeStatus}) — silenced ${toSilence.length} non-notify event(s)`,
    );
  }

  const n = toNotify.length;
  if (n === 0) {
    log("Notify", `post-scrape (${scrapeStatus}) — no new listings, skip push`);
    return 0;
  }

  // All-new batches keep the classic summary; mixed batches get detail lines.
  const news = toNotify.filter((p) => p.event.kind === "first_seen");
  const alerts = toNotify.filter((p) => p.event.kind !== "first_seen");
  let message: string;
  if (alerts.length === 0) {
    message = n === 1 ? "1 new listing available" : `${n} new listings available`;
  } else {
    const lines: string[] = [];
    if (news.length > 0) {
      lines.push(news.length === 1 ? "1 new listing" : `${news.length} new listings`);
    }
    for (const p of alerts.slice(0, MAX_ALERT_LINES)) lines.push(alertLine(p));
    if (alerts.length > MAX_ALERT_LINES) {
      lines.push(`+${alerts.length - MAX_ALERT_LINES} more`);
    }
    message = lines.join("\n");
  }
  log("Notify", `post-scrape (${scrapeStatus}) — ${message.replaceAll("\n", " | ")}`);

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
