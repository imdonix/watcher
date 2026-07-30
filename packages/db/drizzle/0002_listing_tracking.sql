-- Rebuild listings as permanent catalog + sightings/events.
-- Previous listings rows are dropped (incompatible shape from first versions).

DROP TABLE IF EXISTS "listing_events" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "listing_sightings" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "scrape_routine_results" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "listings" CASCADE;--> statement-breakpoint

CREATE TABLE "listings" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"engine_slug" varchar(64) NOT NULL,
	"url" text NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_price" integer,
	"last_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "listing_sightings" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" varchar(64) NOT NULL,
	"scrape_run_id" integer NOT NULL,
	"search_routine_id" integer,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"price" integer,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint

CREATE TABLE "listing_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" varchar(64) NOT NULL,
	"scrape_run_id" integer,
	"search_routine_id" integer,
	"kind" varchar(32) NOT NULL,
	"old_price" integer,
	"new_price" integer,
	"notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "scrape_routine_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"scrape_run_id" integer NOT NULL,
	"search_routine_id" integer,
	"engine_slug" varchar(64) NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"pages_planned" integer DEFAULT 0,
	"pages_fetched" integer DEFAULT 0,
	"pages_failed" integer DEFAULT 0,
	"items_seen" integer DEFAULT 0,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "listing_sightings" ADD CONSTRAINT "listing_sightings_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_sightings" ADD CONSTRAINT "listing_sightings_scrape_run_id_scrape_runs_id_fk" FOREIGN KEY ("scrape_run_id") REFERENCES "public"."scrape_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_sightings" ADD CONSTRAINT "listing_sightings_search_routine_id_search_routines_id_fk" FOREIGN KEY ("search_routine_id") REFERENCES "public"."search_routines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_events" ADD CONSTRAINT "listing_events_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_events" ADD CONSTRAINT "listing_events_scrape_run_id_scrape_runs_id_fk" FOREIGN KEY ("scrape_run_id") REFERENCES "public"."scrape_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_events" ADD CONSTRAINT "listing_events_search_routine_id_search_routines_id_fk" FOREIGN KEY ("search_routine_id") REFERENCES "public"."search_routines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_routine_results" ADD CONSTRAINT "scrape_routine_results_scrape_run_id_scrape_runs_id_fk" FOREIGN KEY ("scrape_run_id") REFERENCES "public"."scrape_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_routine_results" ADD CONSTRAINT "scrape_routine_results_search_routine_id_search_routines_id_fk" FOREIGN KEY ("search_routine_id") REFERENCES "public"."search_routines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "scrape_runs" ADD COLUMN IF NOT EXISTS "routines_complete" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD COLUMN IF NOT EXISTS "sightings_created" integer DEFAULT 0;