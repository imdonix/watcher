-- Cached Árukereső shop-price estimate per listing (Market check).
CREATE TABLE IF NOT EXISTS "market_prices" (
  "listing_id" varchar(64) PRIMARY KEY NOT NULL,
  "query" text NOT NULL,
  "shop_price" integer NOT NULL,
  "shop_price_low" integer,
  "shop_price_high" integer,
  "sample_size" integer DEFAULT 0 NOT NULL,
  "confidence" varchar(16) DEFAULT 'similar' NOT NULL,
  "matched_tokens" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "product_name" text,
  "product_url" text,
  "offers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "market_prices"
    ADD CONSTRAINT "market_prices_listing_id_listings_id_fk"
    FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
