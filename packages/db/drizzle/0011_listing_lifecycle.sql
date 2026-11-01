-- Listing lifecycle: missing-item verification and permanent deletion.
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "last_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
