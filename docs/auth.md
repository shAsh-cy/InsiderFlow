# Authentication

InsiderFlow is a **public, read-only site by default**. Accounts exist only to
sync a watchlist across devices and to receive alerts. With no Supabase project
configured, every page, the API, RSS, and the live stream work exactly as
before — the sign-in link simply does not appear.

## The decision: hosted Supabase for sessions, our Postgres for data

The addendum offered two options. We chose **(b)**: Supabase Auth handles
sessions; **all application data — including the user tables — lives in our own
Postgres**, keyed by the Supabase user id (the JWT `sub`).

Why:

- **The dev stack stays one container.** `docker compose up` gives you Postgres
  and the whole app. The Supabase CLI stack (`supabase start`) runs ~10
  containers and several GB of images for a feature the majority of local work
  never touches.
- **Drizzle stays the single source of truth.** User tables are ordinary
  migrations in `packages/db/drizzle/`, reviewed like any other schema change.
  Nothing is defined in a Supabase dashboard.
- **Ingestion never needs auth.** The Cloudflare worker, the backfill action,
  and the india-local runner all write through plain Postgres. Coupling them to
  the Supabase platform would buy nothing.
- **Auth stays swappable.** Only `src/lib/auth/*` and the middleware know about
  Supabase. Moving to another provider means changing the JWT source, not the
  schema.

The cost: **local development has no real session issuer.** You cannot mint a
magic link against a database that has no GoTrue. Work locally either signed
out (everything except settings/alerts behaves normally) or point
`NEXT_PUBLIC_SUPABASE_*` at a free hosted project — sessions come from Supabase
while data still comes from your local Postgres.

## Two layers of protection

1. **Query-layer scoping — primary.** Every function in
   `apps/web/src/lib/api/user-queries.ts` takes `userId` first and scopes the
   statement by it. The server connects to Postgres directly as the app role,
   so this is what protects data on every real request path. _Never add a
   function there that touches a user table without a `user_id` predicate._
2. **RLS — defence in depth.** `user_watchlists`, `alert_rules`,
   `alert_channels`, and `alerts_log` carry `FORCE ROW LEVEL SECURITY` with
   policies keyed on `current_setting('app.user_id')`, and the web app
   connects as **`insiderflow_app`** — a role with `NOBYPASSRLS`. A query with
   no user context returns nothing; a query with one returns that user's rows
   and nobody else's, WHERE clause or not.

Every function in `user-queries.ts` opens that context through
`withUserContext`, which sets the GUC with `set_config(..., true)` — local to
the transaction, so it cannot leak to the next borrower of a pooled
connection.

### What this looked like before, and why it was worse than nothing

Migration `0006` enabled RLS and wrote policies against Supabase's
`auth.uid()`. That configuration enforced **nothing**:

- `FORCE ROW LEVEL SECURITY` was never set, so the table owner — which is who
  the app connected as — skipped every policy.
- The server talks to Postgres **directly**. No end-user JWT is anywhere in
  the connection, so `auth.uid()` was always NULL; the predicate guarded a
  browser-to-PostgREST path this project does not have.
- `rls.test.ts` "proved" isolation against a hand-built two-table replica of
  the schema rather than the real migrations, so it stayed green throughout.
- `bootstrap.mjs` reported `check_ok: rls` on the strength of
  `pg_class.relrowsecurity` alone — certifying a control that did nothing,
  which is worse than no check because it stops anyone looking again.

All four are fixed, and the fix is verified rather than asserted:

```console
$ APP_DATABASE_URL='postgres://insiderflow_app:...@host/db' pnpm db:bootstrap -- --check
{"event":"check_ok","check":"rls_forced"}
{"event":"check_ok","check":"rls_enforced",
 "proof":"no context → 0 rows; owner context → 1 row; other user → 0 rows",
 "app_role":"insiderflow_app"}
```

Bootstrap inserts a probe row as admin and tries to read it back over
`APP_DATABASE_URL` with no context set. Visible → `rls_not_enforced`, loudly.
`APP_DATABASE_URL` unset → `rls_not_proven`, also a failure: enforcement is
never taken on trust, because the flags were true the whole time it was inert.
`--skip-rls-proof` exists for a database that has no app role yet, and says so
in the output.

`packages/db/src/rls.test.ts` now runs the actual `drizzle/*.sql` files on
PGlite and exercises the policies as `insiderflow_app`, including the case
that matters most: **an unscoped `SELECT * FROM alert_rules` returns only the
caller's rows.** That is the day-someone-forgets scenario the query layer
cannot cover.

### Capability tokens

Two operations have no session and cannot have one: the Telegram
`/start <token>` webhook and one-click email unsubscribe. Both run under
`withCapability`, where the policy compares the caller's token against the
row's own `link_token` / `unsubscribe_token`. The database decides which
single row is reachable, so even `UPDATE alert_channels SET ...` with no
`WHERE` touches exactly the row whose 192-bit token the caller already held.

### Who connects as what

| Component                                   | Role              | Why                                                                                                      |
| ------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| Web app (Vercel, docker `web`)              | `insiderflow_app` | Request path. Must be bound by RLS.                                                                      |
| Migrations, `db:bootstrap`, seed            | admin / owner     | Creates the policies; cannot be subject to them.                                                         |
| Ingestion worker, analytics jobs, ops-check | admin / owner     | Legitimately scan every user's rules to decide what to deliver. Not a request path, no user to scope to. |

`pnpm db:app-role` creates the login for `insiderflow_app` from
`APP_DB_PASSWORD` and refuses to finish if the role ends up with `SUPERUSER`
or `BYPASSRLS`.

## Environment

| Variable                        | Where           | Purpose                                       |
| ------------------------------- | --------------- | --------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | web             | Supabase project URL. Empty ⇒ auth disabled.  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web             | Public anon key (safe in the browser).        |
| `DATABASE_URL`                  | web + ingestion | Our Postgres. Holds **all** application data. |

Enable GitHub OAuth and email magic links in the Supabase dashboard, with
`https://<your-deployment>/auth/callback` as the redirect URL.

## Sign-in flow

1. `/login` — magic link or GitHub OAuth via `@supabase/ssr`.
2. `/auth/callback` — exchanges the code for a session and seeds the user's
   email channel so digests work with no extra setup.
3. `src/middleware.ts` refreshes the session cookie on navigation (and no-ops
   entirely when auth is unconfigured).
4. On first visit to `/settings`, a banner offers one-click import of a
   watchlist saved in `localStorage` while signed out.
