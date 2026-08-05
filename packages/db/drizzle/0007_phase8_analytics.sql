CREATE TYPE "public"."alert_kind" AS ENUM('transaction', 'cluster', 'politician');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('pending', 'delivered', 'orphaned');--> statement-breakpoint
CREATE TYPE "public"."chamber" AS ENUM('house', 'senate');--> statement-breakpoint
CREATE TYPE "public"."cluster_direction" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."politician_txn_type" AS ENUM('purchase', 'sale', 'sale_partial', 'sale_full', 'exchange');--> statement-breakpoint
CREATE TABLE "cluster_flags" (
	"company_id" uuid NOT NULL,
	"direction" "cluster_direction" NOT NULL,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"insider_count" integer NOT NULL,
	"trade_count" integer NOT NULL,
	"total_usd" numeric(24, 4),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cluster_flags_company_id_direction_window_start_pk" PRIMARY KEY("company_id","direction","window_start")
);
--> statement-breakpoint
CREATE TABLE "company_anomalies" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"window_days" integer DEFAULT 30 NOT NULL,
	"net_usd" numeric(24, 4) NOT NULL,
	"baseline_mean" numeric(24, 4),
	"baseline_stddev" numeric(24, 4),
	"z_score" numeric(12, 6),
	"sample_size" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insider_scores" (
	"insider_id" uuid PRIMARY KEY NOT NULL,
	"scored_trades" integer DEFAULT 0 NOT NULL,
	"wins_90d" integer DEFAULT 0 NOT NULL,
	"hit_rate_90d" numeric(9, 6),
	"avg_excess_30d" numeric(12, 6),
	"avg_excess_90d" numeric(12, 6),
	"avg_excess_180d" numeric(12, 6),
	"median_excess_90d" numeric(12, 6),
	"realized_trades" integer DEFAULT 0 NOT NULL,
	"realized_return_pct" numeric(12, 6),
	"score" numeric(12, 6),
	"last_trade_date" date,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "politician_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"politician_id" uuid NOT NULL,
	"company_id" uuid,
	"ticker" text,
	"asset_description" text NOT NULL,
	"asset_type" text,
	"txn_type" "politician_txn_type" NOT NULL,
	"txn_date" date NOT NULL,
	"disclosed_at" date,
	"amount_min" numeric(24, 2),
	"amount_max" numeric(24, 2),
	"amount_range" text,
	"owner" text,
	"comment" text,
	"source" text NOT NULL,
	"source_url" text,
	"dedup_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "politicians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_key" text NOT NULL,
	"name" text NOT NULL,
	"chamber" "chamber" NOT NULL,
	"party" text,
	"state" text,
	"district" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_returns" (
	"transaction_id" uuid PRIMARY KEY NOT NULL,
	"insider_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"direction" "cluster_direction" NOT NULL,
	"txn_date" date NOT NULL,
	"entry_close" numeric(20, 4) NOT NULL,
	"ret_30d" numeric(12, 6),
	"ret_90d" numeric(12, 6),
	"ret_180d" numeric(12, 6),
	"bench_30d" numeric(12, 6),
	"bench_90d" numeric(12, 6),
	"bench_180d" numeric(12, 6),
	"excess_30d" numeric(12, 6),
	"excess_90d" numeric(12, 6),
	"excess_180d" numeric(12, 6),
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_rules" ADD COLUMN "kind" "alert_kind" DEFAULT 'transaction' NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts_log" ADD COLUMN "kind" "alert_kind" DEFAULT 'transaction' NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts_log" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "alerts_log" ADD COLUMN "defer_reason" text;--> statement-breakpoint
ALTER TABLE "alerts_log" ADD COLUMN "status" "alert_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "industry" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "sic_code" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "sic_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cluster_flags" ADD CONSTRAINT "cluster_flags_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_anomalies" ADD CONSTRAINT "company_anomalies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insider_scores" ADD CONSTRAINT "insider_scores_insider_id_insiders_id_fk" FOREIGN KEY ("insider_id") REFERENCES "public"."insiders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "politician_trades" ADD CONSTRAINT "politician_trades_politician_id_politicians_id_fk" FOREIGN KEY ("politician_id") REFERENCES "public"."politicians"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "politician_trades" ADD CONSTRAINT "politician_trades_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_returns" ADD CONSTRAINT "trade_returns_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_returns" ADD CONSTRAINT "trade_returns_insider_id_insiders_id_fk" FOREIGN KEY ("insider_id") REFERENCES "public"."insiders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_returns" ADD CONSTRAINT "trade_returns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cluster_flags_window_end_idx" ON "cluster_flags" USING btree ("window_end");--> statement-breakpoint
CREATE INDEX "cluster_flags_company_idx" ON "cluster_flags" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_anomalies_z_idx" ON "company_anomalies" USING btree ("z_score");--> statement-breakpoint
CREATE INDEX "insider_scores_score_idx" ON "insider_scores" USING btree ("score");--> statement-breakpoint
CREATE INDEX "insider_scores_rank_idx" ON "insider_scores" USING btree ("scored_trades");--> statement-breakpoint
CREATE UNIQUE INDEX "politician_trades_dedup_key_unique" ON "politician_trades" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "politician_trades_politician_idx" ON "politician_trades" USING btree ("politician_id");--> statement-breakpoint
CREATE INDEX "politician_trades_ticker_idx" ON "politician_trades" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "politician_trades_txn_date_idx" ON "politician_trades" USING btree ("txn_date");--> statement-breakpoint
CREATE INDEX "politician_trades_company_idx" ON "politician_trades" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "politician_trades_created_idx" ON "politician_trades" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "politicians_external_key_unique" ON "politicians" USING btree ("external_key");--> statement-breakpoint
CREATE INDEX "politicians_name_idx" ON "politicians" USING btree ("name");--> statement-breakpoint
CREATE INDEX "politicians_chamber_idx" ON "politicians" USING btree ("chamber");--> statement-breakpoint
CREATE INDEX "trade_returns_insider_idx" ON "trade_returns" USING btree ("insider_id");--> statement-breakpoint
CREATE INDEX "trade_returns_company_idx" ON "trade_returns" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "trade_returns_txn_date_idx" ON "trade_returns" USING btree ("txn_date");--> statement-breakpoint
CREATE INDEX "alerts_log_status_idx" ON "alerts_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "companies_sector_idx" ON "companies" USING btree ("sector");--> statement-breakpoint
-- Cleanup: alerts whose subject transaction no longer exists (a fixture purge,
-- a hard delete) were previously invisible AND undeliverable — dispatch joins
-- the transaction to render the message, so they sat pending forever with no
-- signal. Retire them to the new terminal state so the queue is honest.
UPDATE "alerts_log" SET "status" = 'orphaned', "error" = coalesce("error", 'subject transaction no longer exists')
 WHERE "delivered_at" IS NULL
   AND "transaction_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "transactions" t WHERE t.id = "alerts_log"."transaction_id");--> statement-breakpoint
-- Rows already delivered are, by definition, not pending.
UPDATE "alerts_log" SET "status" = 'delivered' WHERE "delivered_at" IS NOT NULL;
