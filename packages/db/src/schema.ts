import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/** User-defined scrape search configurations */
export const searchRoutines = pgTable("search_routines", {
  id: serial("id").primaryKey(),
  engineId: integer("engine_id").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** History of scrape job executions (one run may cover many routines). */
export const scrapeRuns = pgTable("scrape_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** running | done | incomplete | error */
  status: varchar("status", { length: 32 }).notNull().default("running"),
  routinesTotal: integer("routines_total").default(0),
  routinesComplete: integer("routines_complete").default(0),
  listingsFound: integer("listings_found").default(0),
  sightingsCreated: integer("sightings_created").default(0),
  error: text("error"),
});

/**
 * Permanent catalog of marketplace items (never deleted).
 * Identity is stable across scrapes (hash of engine + listing identity).
 */
export const listings = pgTable("listings", {
  id: varchar("id", { length: 64 }).primaryKey(),
  engineSlug: varchar("engine_slug", { length: 64 }).notNull(),
  url: text("url").notNull(),
  name: text("name").notNull(),
  imageUrl: text("image_url"),
  /** active = last complete scrape still saw it; missing = absent after a complete scrape */
  status: varchar("status", { length: 16 }).notNull().default("active"),
  /**
   * User dismissed this listing. Same UI treatment as missing.
   * Cleared automatically when price changes (treated as "new" again).
   */
  notInterested: boolean("not_interested").notNull().default(false),
  notInterestedAt: timestamp("not_interested_at", { withTimezone: true }),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  lastPrice: integer("last_price"),
  lastData: jsonb("last_data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** One row per observation of a listing during a scrape (price history, presence). */
export const listingSightings = pgTable("listing_sightings", {
  id: serial("id").primaryKey(),
  listingId: varchar("listing_id", { length: 64 })
    .notNull()
    .references(() => listings.id, { onDelete: "cascade" }),
  scrapeRunId: integer("scrape_run_id")
    .notNull()
    .references(() => scrapeRuns.id, { onDelete: "cascade" }),
  searchRoutineId: integer("search_routine_id").references(() => searchRoutines.id, {
    onDelete: "set null",
  }),
  observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
  price: integer("price"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
});

/**
 * Domain events: first_seen | price_change | missing | reappeared
 */
export const listingEvents = pgTable("listing_events", {
  id: serial("id").primaryKey(),
  listingId: varchar("listing_id", { length: 64 })
    .notNull()
    .references(() => listings.id, { onDelete: "cascade" }),
  scrapeRunId: integer("scrape_run_id").references(() => scrapeRuns.id, {
    onDelete: "set null",
  }),
  searchRoutineId: integer("search_routine_id").references(() => searchRoutines.id, {
    onDelete: "set null",
  }),
  kind: varchar("kind", { length: 32 }).notNull(),
  oldPrice: integer("old_price"),
  newPrice: integer("new_price"),
  notified: boolean("notified").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Per-routine outcome inside a scrape run (drives missing-item safety). */
export const scrapeRoutineResults = pgTable("scrape_routine_results", {
  id: serial("id").primaryKey(),
  scrapeRunId: integer("scrape_run_id")
    .notNull()
    .references(() => scrapeRuns.id, { onDelete: "cascade" }),
  searchRoutineId: integer("search_routine_id").references(() => searchRoutines.id, {
    onDelete: "set null",
  }),
  engineSlug: varchar("engine_slug", { length: 64 }).notNull(),
  complete: boolean("complete").notNull().default(false),
  pagesPlanned: integer("pages_planned").default(0),
  pagesFetched: integer("pages_fetched").default(0),
  pagesFailed: integer("pages_failed").default(0),
  itemsSeen: integer("items_seen").default(0),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const webPushSubscriptions = pgTable("web_push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const schedulerState = pgTable(
  "scheduler_state",
  {
    id: integer("id").primaryKey().default(1),
    lastScrapeAt: timestamp("last_scrape_at", { withTimezone: true }),
    nextScrapeAt: timestamp("next_scrape_at", { withTimezone: true }),
    lastNotifyAt: timestamp("last_notify_at", { withTimezone: true }),
    nextNotifyAt: timestamp("next_notify_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  () => [check("scheduler_state_singleton", sql`id = 1`)],
);

export const settings = pgTable("settings", {
  key: varchar("key", { length: 128 }).primaryKey(),
  type: varchar("type", { length: 32 }).notNull(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const routines = searchRoutines;
export const items = listings;
export const pushSubscriptions = webPushSubscriptions;

export type SearchRoutine = typeof searchRoutines.$inferSelect;
export type NewSearchRoutine = typeof searchRoutines.$inferInsert;
export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
export type ListingSighting = typeof listingSightings.$inferSelect;
export type ListingEvent = typeof listingEvents.$inferSelect;
export type ScrapeRun = typeof scrapeRuns.$inferSelect;
export type ScrapeRoutineResult = typeof scrapeRoutineResults.$inferSelect;
export type WebPushSubscription = typeof webPushSubscriptions.$inferSelect;
export type SchedulerState = typeof schedulerState.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;

export type Routine = SearchRoutine;
export type Item = Listing;
export type NewRoutine = NewSearchRoutine;
export type NewItem = NewListing;
export type PushSubscriptionRow = WebPushSubscription;
