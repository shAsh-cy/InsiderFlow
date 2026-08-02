CREATE TABLE "bulk_block_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country" text DEFAULT 'IN' NOT NULL,
	"exchange" text DEFAULT 'NSE' NOT NULL,
	"deal_type" text NOT NULL,
	"deal_date" date NOT NULL,
	"symbol" text NOT NULL,
	"company_name" text,
	"client_name" text NOT NULL,
	"side" text NOT NULL,
	"quantity" numeric(20, 4) NOT NULL,
	"wap" numeric(20, 4),
	"value" numeric(24, 4),
	"currency" text DEFAULT 'INR' NOT NULL,
	"value_usd" numeric(24, 4),
	"remarks" text,
	"dedup_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pledge_disclosures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country" text DEFAULT 'IN' NOT NULL,
	"exchange" text DEFAULT 'NSE' NOT NULL,
	"symbol" text NOT NULL,
	"company_name" text,
	"promoter_name" text NOT NULL,
	"event_type" text,
	"shares" numeric(20, 4),
	"shares_pct" numeric(9, 4),
	"value" numeric(24, 4),
	"currency" text DEFAULT 'INR' NOT NULL,
	"value_usd" numeric(24, 4),
	"event_date" date,
	"intimated_at" date,
	"source_url" text,
	"dedup_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sast_disclosures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country" text DEFAULT 'IN' NOT NULL,
	"exchange" text DEFAULT 'NSE' NOT NULL,
	"symbol" text NOT NULL,
	"company_name" text NOT NULL,
	"acquirer_name" text NOT NULL,
	"regulation" text,
	"category" text,
	"acquisition_mode" text,
	"side" text,
	"shares" numeric(20, 4),
	"shares_pct_before" numeric(9, 4),
	"shares_pct_after" numeric(9, 4),
	"value" numeric(24, 4),
	"currency" text DEFAULT 'INR' NOT NULL,
	"value_usd" numeric(24, 4),
	"txn_date" date,
	"intimated_at" date,
	"source_url" text,
	"dedup_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_block_dedup_key_unique" ON "bulk_block_deals" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "bulk_block_symbol_idx" ON "bulk_block_deals" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "bulk_block_deal_date_idx" ON "bulk_block_deals" USING btree ("deal_date");--> statement-breakpoint
CREATE UNIQUE INDEX "pledge_dedup_key_unique" ON "pledge_disclosures" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "pledge_symbol_idx" ON "pledge_disclosures" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "pledge_event_date_idx" ON "pledge_disclosures" USING btree ("event_date");--> statement-breakpoint
CREATE UNIQUE INDEX "sast_dedup_key_unique" ON "sast_disclosures" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "sast_symbol_idx" ON "sast_disclosures" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "sast_txn_date_idx" ON "sast_disclosures" USING btree ("txn_date");