-- AI relevance score (0-100) alongside the derived verdict.
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "ai_score" smallint;
