-- Price-drop / target-price alerting columns on listings.
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "target_price" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "prev_price" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "price_changed_at" timestamp with time zone;
