-- Collapse the old "missing" state into "deleted": a listing that disappears
-- from a complete routine scrape is now deleted directly (no item-page check).
UPDATE "listings"
SET "status" = 'deleted',
    "deleted_at" = COALESCE("deleted_at", "updated_at", now())
WHERE "status" = 'missing';--> statement-breakpoint
UPDATE "listing_events"
SET "kind" = 'deleted'
WHERE "kind" = 'missing';--> statement-breakpoint
ALTER TABLE "listings" DROP COLUMN IF EXISTS "last_verified_at";
