-- Make row-level security actually enforce something.
--
-- 0006 enabled RLS on the four user tables and wrote owner-only policies
-- keyed on Supabase's auth.uid(). A pre-release audit found that setup inert:
--
--   * FORCE ROW LEVEL SECURITY was never set, so the table owner — which is
--     who the app connects as — skipped every policy.
--   * The app connects to Postgres DIRECTLY. There is no end-user JWT in the
--     connection, so auth.uid() was always NULL and the predicate could only
--     ever have guarded a browser-to-PostgREST path this project does not use.
--   * bootstrap.mjs reported `check_ok: rls` regardless, certifying a control
--     that did nothing.
--
-- This migration keys the policies on a transaction-local GUC the server
-- sets (`app.user_id`, via withUserContext in @insiderflow/db), forces RLS so
-- the owner is subject to it, and creates a NOBYPASSRLS application role for
-- the web app to connect as. All three are required — any one alone is
-- decoration.
--
-- The ingestion worker and the analytics jobs deliberately keep using the
-- admin/owner connection: they scan every user's rules to decide what to
-- deliver, which is not a request path and has no user to scope to.

-- ── Identity available to policies ─────────────────────────────────────────
-- plpgsql, not sql, so a malformed GUC fails CLOSED (returns NULL → matches
-- no rows) instead of raising and turning a leak-prevention layer into an
-- outage.
CREATE OR REPLACE FUNCTION public.app_user_id() RETURNS uuid
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  raw text;
BEGIN
  raw := nullif(current_setting('app.user_id', true), '');

  IF raw IS NULL THEN
    -- Fall back to a Supabase JWT claim, so a future direct-from-browser
    -- path (PostgREST, Realtime) is covered by the same policies.
    BEGIN
      raw := nullif(current_setting('request.jwt.claim.sub', true), '');
      IF raw IS NULL THEN
        raw := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
      END IF;
    EXCEPTION WHEN others THEN
      raw := NULL;
    END;
  END IF;

  RETURN raw::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;--> statement-breakpoint

-- Capability tokens (Telegram link, email unsubscribe) arrive with no session.
CREATE OR REPLACE FUNCTION public.app_capability() RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.capability', true), '') $$;--> statement-breakpoint

-- ── Replace the auth.uid() policies ────────────────────────────────────────
DROP POLICY IF EXISTS "user_watchlists_owner" ON "user_watchlists";--> statement-breakpoint
DROP POLICY IF EXISTS "alert_rules_owner" ON "alert_rules";--> statement-breakpoint
DROP POLICY IF EXISTS "alert_channels_owner" ON "alert_channels";--> statement-breakpoint
DROP POLICY IF EXISTS "alerts_log_owner_read" ON "alerts_log";--> statement-breakpoint

CREATE POLICY "user_watchlists_owner" ON "user_watchlists"
  FOR ALL USING (user_id = public.app_user_id())
  WITH CHECK (user_id = public.app_user_id());--> statement-breakpoint

CREATE POLICY "alert_rules_owner" ON "alert_rules"
  FOR ALL USING (user_id = public.app_user_id())
  WITH CHECK (user_id = public.app_user_id());--> statement-breakpoint

CREATE POLICY "alert_channels_owner" ON "alert_channels"
  FOR ALL USING (user_id = public.app_user_id())
  WITH CHECK (user_id = public.app_user_id());--> statement-breakpoint

-- alerts_log is written by the scanner on the admin connection and only ever
-- read by its owner from a request.
CREATE POLICY "alerts_log_owner_read" ON "alerts_log"
  FOR SELECT USING (user_id = public.app_user_id());--> statement-breakpoint

-- Bearer-capability access to a SINGLE channel row. The database checks the
-- 192-bit token itself, so this is narrower than the query layer can express:
-- even `update alert_channels set ...` with no WHERE reaches exactly the row
-- whose token the caller already held.
CREATE POLICY "alert_channels_capability" ON "alert_channels"
  FOR UPDATE
  USING (
    public.app_capability() IS NOT NULL
    AND (link_token = public.app_capability() OR unsubscribe_token = public.app_capability())
  )
  WITH CHECK (
    public.app_capability() IS NOT NULL
    AND (link_token IS NULL OR link_token = public.app_capability()
         OR unsubscribe_token = public.app_capability())
  );--> statement-breakpoint

-- ── Force it, so the owner is not exempt ───────────────────────────────────
ALTER TABLE "user_watchlists" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_channels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alerts_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ── The application role ───────────────────────────────────────────────────
-- Created NOLOGIN and without a password: a credential in a migration is a
-- credential in the repository. `pnpm db:app-role` gives it a login and a
-- password from the environment; docs/security.md covers production.
--
-- NOBYPASSRLS is the point of the whole exercise. NOSUPERUSER is implied by
-- CREATE ROLE but stated for the next reader.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'insiderflow_app') THEN
    CREATE ROLE insiderflow_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE insiderflow_app NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO insiderflow_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO insiderflow_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO insiderflow_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_user_id() TO insiderflow_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_capability() TO insiderflow_app;--> statement-breakpoint

-- ── One deliberate, minimal hole ───────────────────────────────────────────
-- /api/health reports how many alerts are waiting to be delivered. Under RLS
-- the app role sees none of them and the metric would silently read 0 —
-- a monitoring surface that lies is worse than one that is absent.
--
-- So: a SECURITY DEFINER function returning COUNTS ONLY. No row content can
-- leave through it, and the app role gets nothing else. It runs as the
-- migration owner, which is the role that bypasses RLS; if that is not true
-- on some deployment the function returns zeroes, and health.ts reports the
-- metric as unavailable rather than as "queue empty".
CREATE OR REPLACE FUNCTION public.alerts_queue_depth()
RETURNS TABLE (pending bigint, orphaned bigint, failed_permanent bigint)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
-- The ::text casts are load-bearing. drizzle-kit applies pending migrations in
-- ONE transaction, 0008 adds 'failed_permanent' to the alert_status enum, and
-- Postgres parses a SQL function body at CREATE time — so an enum LITERAL here
-- fails with "unsafe use of new value of enum type" on a database migrating
-- 0008 and 0009 together. Comparing as text sidesteps the restriction without
-- needing the two migrations to be separated by a commit.
AS $$
  SELECT count(*) FILTER (WHERE status::text = 'pending'),
         count(*) FILTER (WHERE status::text = 'orphaned'),
         count(*) FILTER (WHERE status::text = 'failed_permanent')
  FROM alerts_log
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.alerts_queue_depth() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.alerts_queue_depth() TO insiderflow_app;--> statement-breakpoint

-- Tables added by later migrations must not silently become unreadable.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO insiderflow_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO insiderflow_app;
