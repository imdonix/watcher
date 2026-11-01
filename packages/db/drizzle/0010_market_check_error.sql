-- Last market-check attempt (success or no-match) and its failure reason.
ALTER TABLE "market_prices" ADD COLUMN IF NOT EXISTS "error" text;--> statement-breakpoint
ALTER TABLE "market_prices" ADD COLUMN IF NOT EXISTS "last_checked_at" timestamp with time zone;--> statement-breakpoint
UPDATE "market_prices"
SET "last_checked_at" = "fetched_at"
WHERE "last_checked_at" IS NULL;
