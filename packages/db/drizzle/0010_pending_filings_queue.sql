CREATE TABLE "pending_filings" (
	"accession_no" text PRIMARY KEY NOT NULL,
	"cik" text NOT NULL,
	"form_type" text NOT NULL,
	"filed_at" timestamp with time zone,
	"source_url" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"discovered_via" text DEFAULT 'feed' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pending_filings_queue_idx" ON "pending_filings" USING btree ("attempts","filed_at");