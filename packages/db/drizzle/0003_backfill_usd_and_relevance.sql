-- Data fix for rows ingested before USD/relevance columns existed (migration 0001
-- added the columns with NULL/default values; this backfills them).
UPDATE "transactions"
SET "price_usd" = "price", "value_usd" = "value"
WHERE "currency" = 'USD' AND "value_usd" IS NULL AND "value" IS NOT NULL;--> statement-breakpoint
UPDATE "transactions"
SET "price_usd" = "price"
WHERE "currency" = 'USD' AND "price_usd" IS NULL AND "price" IS NOT NULL;--> statement-breakpoint
UPDATE "transactions"
SET "relevance" = 'opportunistic'
WHERE "code" IN ('P', 'S') AND "is_10b5_1" = false AND "relevance" = 'routine';
