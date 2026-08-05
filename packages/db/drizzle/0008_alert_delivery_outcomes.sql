-- Terminal delivery failure, and a retry bound.
--
-- Before this, ANY delivery failure left the row 'pending' so the next run
-- would retry. That is right for a 429 or a 5xx and wrong for a 400: Telegram
-- answers 400 when it cannot parse the payload, and the same bytes fail on
-- every retry. One tickerless company named "ZZ Procter & Gamble" was enough
-- to wedge a user's digest permanently, while alertsPending on /status kept
-- counting it as work still to do.
--
-- ADD VALUE is safe inside the migration transaction because nothing below
-- writes the new value — Postgres only forbids USING it in the same
-- transaction that creates it.

ALTER TYPE "public"."alert_status" ADD VALUE 'failed_permanent';--> statement-breakpoint
ALTER TABLE "alerts_log" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;