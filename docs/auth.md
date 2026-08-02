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
2. **RLS — defense in depth.** `user_watchlists`, `alert_rules`,
   `alert_channels`, and `alerts_log` have RLS enabled with owner-only
   policies. This catches anything reaching Postgres with an end-user JWT (the
   Supabase anon key, PostgREST, a future direct-from-browser path).

Policies use `auth.uid()`. On Supabase that is built in; migration `0006`
installs a **compatible shim** on plain Postgres reading the same
`request.jwt.claims` GUC, so RLS behaves identically locally and is testable
without the Supabase platform — see `packages/db/src/rls.test.ts`, which proves
user A cannot read, update, or delete user B's rows and that `WITH CHECK`
blocks forged writes.

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
