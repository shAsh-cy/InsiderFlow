-- Row Level Security for the user-scoped tables.
--
-- Enforcement model (defense in depth):
--   1. PRIMARY — the shared query layer scopes every read/write by user_id.
--      The server connects to Postgres directly as the app role, so this is
--      what actually protects data on every request path.
--   2. RLS — blocks any client that reaches Postgres with an end-user JWT
--      (Supabase anon key / PostgREST / a future direct-from-browser path).
--
-- Policies use auth.uid(), which is Supabase's own function. On plain
-- Postgres (local dev, PGlite tests) we create a compatible shim reading
-- the same `request.jwt.claims` GUC, so RLS behaves identically in both
-- environments and can be tested without the Supabase platform.

CREATE SCHEMA IF NOT EXISTS auth;--> statement-breakpoint

-- Only define the shim when Supabase has not already provided auth.uid().
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $body$
        SELECT nullif(
          coalesce(
            current_setting('request.jwt.claim.sub', true),
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
          ),
          ''
        )::uuid
      $body$;
    $fn$;
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "user_watchlists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alerts_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Owner-only access on every user table. FOR ALL covers select/insert/
-- update/delete; WITH CHECK stops a user writing rows owned by someone else.
CREATE POLICY "user_watchlists_owner" ON "user_watchlists"
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "alert_rules_owner" ON "alert_rules"
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());--> statement-breakpoint
CREATE POLICY "alert_channels_owner" ON "alert_channels"
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());--> statement-breakpoint
-- alerts_log is written by the scanner (service role, which bypasses RLS)
-- and only ever read by its owner.
CREATE POLICY "alerts_log_owner_read" ON "alerts_log"
  FOR SELECT USING (user_id = auth.uid());--> statement-breakpoint

-- Seed the scanner's cursor row so the first run has something to CAS against.
INSERT INTO "scanner_state" ("name") VALUES ('alerts')
  ON CONFLICT ("name") DO NOTHING;
