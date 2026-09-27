-- AI evaluation verdict per listing (cloud model, routine prompt).
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "ai_verdict" varchar(16);--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "ai_reason" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "ai_model" varchar(128);--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "ai_evaluated_at" timestamp with time zone;
