CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."transaction_code" AS ENUM('P', 'S', 'V', 'A', 'D', 'F', 'I', 'M', 'C', 'E', 'H', 'O', 'X', 'G', 'L', 'W', 'Z', 'J', 'K', 'U');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cik" text NOT NULL,
	"ticker" text,
	"name" text NOT NULL,
	"exchange" text,
	"sector" text,
	"country" text DEFAULT 'US' NOT NULL,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "filings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accession_no" text NOT NULL,
	"form_type" text NOT NULL,
	"filed_at" timestamp with time zone NOT NULL,
	"source_url" text,
	"issuer_company_id" uuid NOT NULL,
	"raw_xml_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insiders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cik" text NOT NULL,
	"name" text NOT NULL,
	"is_director" boolean DEFAULT false NOT NULL,
	"is_officer" boolean DEFAULT false NOT NULL,
	"is_ten_pct_owner" boolean DEFAULT false NOT NULL,
	"officer_title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filing_id" uuid NOT NULL,
	"insider_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"txn_date" date NOT NULL,
	"code" "transaction_code" NOT NULL,
	"shares" numeric(20, 4),
	"price" numeric(20, 4),
	"value" numeric(24, 4),
	"acquired_disposed" text,
	"shares_owned_after" numeric(20, 4),
	"is_10b5_1" boolean DEFAULT false NOT NULL,
	"is_derivative" boolean DEFAULT false NOT NULL,
	"footnote" text,
	"country" text DEFAULT 'US' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "filings" ADD CONSTRAINT "filings_issuer_company_id_companies_id_fk" FOREIGN KEY ("issuer_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_filing_id_filings_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."filings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_insider_id_insiders_id_fk" FOREIGN KEY ("insider_id") REFERENCES "public"."insiders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_cik_unique" ON "companies" USING btree ("cik");--> statement-breakpoint
CREATE INDEX "companies_ticker_idx" ON "companies" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "companies_name_trgm_idx" ON "companies" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "filings_accession_no_unique" ON "filings" USING btree ("accession_no");--> statement-breakpoint
CREATE INDEX "filings_issuer_company_id_idx" ON "filings" USING btree ("issuer_company_id");--> statement-breakpoint
CREATE INDEX "filings_filed_at_idx" ON "filings" USING btree ("filed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "insiders_cik_unique" ON "insiders" USING btree ("cik");--> statement-breakpoint
CREATE INDEX "insiders_name_trgm_idx" ON "insiders" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "transactions_filing_id_idx" ON "transactions" USING btree ("filing_id");--> statement-breakpoint
CREATE INDEX "transactions_insider_id_idx" ON "transactions" USING btree ("insider_id");--> statement-breakpoint
CREATE INDEX "transactions_company_id_idx" ON "transactions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "transactions_txn_date_idx" ON "transactions" USING btree ("txn_date");--> statement-breakpoint
CREATE INDEX "transactions_code_idx" ON "transactions" USING btree ("code");