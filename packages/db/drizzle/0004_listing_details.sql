-- One-time item-page detail scrape (engine-specific payload).
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "details" jsonb;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "details_scraped_at" timestamp with time zone;--> statement-breakpoint
