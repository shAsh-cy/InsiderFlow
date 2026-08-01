CREATE TABLE "api_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_prices" (
	"symbol" text NOT NULL,
	"market" text DEFAULT 'US' NOT NULL,
	"price_date" date NOT NULL,
	"close" numeric(20, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"source" text DEFAULT 'stooq' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_prices_symbol_market_price_date_pk" PRIMARY KEY("symbol","market","price_date")
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"currency" text NOT NULL,
	"date" date NOT NULL,
	"rate_usd" numeric(20, 10) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_currency_date_pk" PRIMARY KEY("currency","date")
);
--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "cik" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "insiders" ALTER COLUMN "cik" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "filing_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "external_key" text;--> statement-breakpoint
UPDATE "companies" SET "external_key" = 'cik:' || "cik" WHERE "external_key" IS NULL;--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "external_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "insiders" ADD COLUMN "external_key" text;--> statement-breakpoint
UPDATE "insiders" SET "external_key" = 'cik:' || "cik" WHERE "external_key" IS NULL;--> statement-breakpoint
ALTER TABLE "insiders" ALTER COLUMN "external_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "source" text DEFAULT 'edgar' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "raw_code" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "price_usd" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "value_usd" numeric(24, 4);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "relevance" text DEFAULT 'routine' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "dedup_key" text;--> statement-breakpoint
-- Rows ingested before cross-source dedup existed get a unique placeholder key.
UPDATE "transactions" SET "dedup_key" = 'legacy#' || "id"::text WHERE "dedup_key" IS NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "dedup_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_external_key_unique" ON "companies" USING btree ("external_key");--> statement-breakpoint
CREATE UNIQUE INDEX "insiders_external_key_unique" ON "insiders" USING btree ("external_key");--> statement-breakpoint
CREATE INDEX "insiders_name_idx" ON "insiders" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_dedup_key_unique" ON "transactions" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "transactions_source_idx" ON "transactions" USING btree ("source");--> statement-breakpoint
CREATE INDEX "transactions_relevance_idx" ON "transactions" USING btree ("relevance");