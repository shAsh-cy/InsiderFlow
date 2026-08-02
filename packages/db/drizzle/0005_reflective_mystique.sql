CREATE TYPE "public"."alert_channel" AS ENUM('telegram', 'email', 'webpush');--> statement-breakpoint
CREATE TYPE "public"."alert_mode" AS ENUM('instant', 'digest');--> statement-breakpoint
CREATE TYPE "public"."watchlist_kind" AS ENUM('company', 'insider');--> statement-breakpoint
CREATE TABLE "alert_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "alert_channel" NOT NULL,
	"destination" text,
	"verified" boolean DEFAULT false NOT NULL,
	"link_token" text,
	"unsubscribe_token" text,
	"digest_hour" text DEFAULT '08:00' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"filters" jsonb,
	"tracked_ticker" text,
	"tracked_insider_id" uuid,
	"mode" "alert_mode" DEFAULT 'digest' NOT NULL,
	"channels" jsonb DEFAULT '["telegram"]'::jsonb NOT NULL,
	"quiet_hours_start" text,
	"quiet_hours_end" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"dedup_key" text NOT NULL,
	"transaction_id" uuid,
	"mode" "alert_mode" NOT NULL,
	"delivered_at" timestamp with time zone,
	"delivered_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scanner_state" (
	"name" text PRIMARY KEY NOT NULL,
	"cursor_created_at" timestamp with time zone,
	"cursor_id" uuid,
	"locked_until" timestamp with time zone,
	"lock_owner" text,
	"last_run_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "watchlist_kind" NOT NULL,
	"ref_id" text NOT NULL,
	"label" text NOT NULL,
	"market" text DEFAULT 'US' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts_log" ADD CONSTRAINT "alerts_log_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_channels_user_channel_unique" ON "alert_channels" USING btree ("user_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_channels_link_token_unique" ON "alert_channels" USING btree ("link_token");--> statement-breakpoint
CREATE INDEX "alert_channels_user_idx" ON "alert_channels" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alert_rules_user_idx" ON "alert_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alert_rules_enabled_idx" ON "alert_rules" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_log_rule_dedup_unique" ON "alerts_log" USING btree ("rule_id","dedup_key");--> statement-breakpoint
CREATE INDEX "alerts_log_user_idx" ON "alerts_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alerts_log_pending_idx" ON "alerts_log" USING btree ("delivered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_watchlists_unique" ON "user_watchlists" USING btree ("user_id","kind","ref_id");--> statement-breakpoint
CREATE INDEX "user_watchlists_user_idx" ON "user_watchlists" USING btree ("user_id");