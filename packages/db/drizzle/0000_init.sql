CREATE TABLE "listings" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"engine_slug" varchar(64),
	"notified" boolean DEFAULT false NOT NULL,
	"data" jsonb NOT NULL,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_routines" (
	"id" serial PRIMARY KEY NOT NULL,
	"engine_id" integer NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_scrape_at" timestamp with time zone,
	"next_scrape_at" timestamp with time zone,
	"last_notify_at" timestamp with time zone,
	"next_notify_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduler_state_singleton" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" varchar(32) DEFAULT 'running' NOT NULL,
	"routines_total" integer DEFAULT 0,
	"listings_found" integer DEFAULT 0,
	"error" text
);
