-- Why a listing is hidden: 'user' (manual) or 'ai' (automatic rejection).
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "not_interested_reason" varchar(16);

-- Existing hidden rows predate the AI auto-hide policy: conservatively treat
-- them as user dismissals.
UPDATE "listings"
SET "not_interested_reason" = 'user'
WHERE "not_interested" = true
  AND "not_interested_reason" IS NULL;

-- Apply the "AI fail means hidden" policy to listings evaluated before it
-- existed. New verdicts set this directly in the API.
UPDATE "listings"
SET "not_interested" = true,
    "not_interested_at" = COALESCE("ai_evaluated_at", now()),
    "not_interested_reason" = 'ai'
WHERE "ai_verdict" = 'fail'
  AND "not_interested" = false;
