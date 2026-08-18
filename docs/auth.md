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

| Variable                        | Where           | Purpose                                                                |
| ------------------------------- | --------------- | ---------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | web             | Supabase project URL. Empty ⇒ auth disabled. Public by design.         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web             | Public anon key (safe in the browser, see docs/security.md).           |
| `APP_DATABASE_URL`              | web             | The `insiderflow_app` role. RLS-bound. What the request path must use. |
| `DATABASE_URL`                  | ingestion, jobs | Admin/owner connection. Migrations and cron jobs only.                 |
| `APP_DB_PASSWORD`               | local setup, CI | Read by `pnpm db:app-role` when issuing the app role's login.          |

Enable GitHub OAuth and email magic links in the Supabase dashboard, with
`https://<your-deployment>/auth/callback` as the redirect URL.

### Production providers: GitHub OAuth and magic link, and nothing else

**Email + password must be OFF on the production project.** It exists only so
`e2e/auth-isolation.spec.ts` — the cross-user exploitation suite — can mint two
real users on a DEV project. Enable it there, with email confirmation turned
off, and nowhere else. Without it those tests skip and say so in the output
rather than passing silently.

Leaving it on in production adds a credential this product otherwise does not
have: a password to phish, to stuff from a breach list, to reset over email, to
store. None of that risk buys anything, because no part of the UI offers a
password field — `apps/web/e2e/auth-providers.spec.ts` asserts that, so a
future form cannot appear without a test going red.

That is also why "hash passwords properly" is **N/A** for this project rather
than done: with the provider off there is no password for InsiderFlow to hash,
salt, or leak. Supabase Auth (GoTrue) hashes with bcrypt on the dev project;
that is its business and never ours, because the application never sees the
credential.

Turn it off:

1. Supabase dashboard → **Authentication → Sign In / Providers**.
2. **Email** → turn **Enable email provider** off, or keep the provider on for
   magic links and turn **Enable email password sign-in** off. The second is
   the usual shape, since magic links use the same email provider.
3. Confirm on **Authentication → Users** that no user has a password identity.

Verify from outside the dashboard, against the deployed project:

```bash
# Must answer 400/422 with "email_provider_disabled" or similar — never 200.
curl -sS -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/signup"   -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"   -H "Content-Type: application/json"   -d '{"email":"probe@example.com","password":"probe-not-a-real-password"}'
```

### Bot protection: Cloudflare Turnstile

The magic-link form takes an email address and causes an email to be sent.
Whoever owns that primitive can point it at other people's inboxes and spend
this deployment's sending reputation delivering them — which costs the Resend
quota first and the domain's reputation second.

Supabase Auth has its own rate limits, and they are the obvious answer rather
than a sufficient one: through 2025–2026 they have been reported repeatedly as
inconsistently enforced across projects, and a control that cannot be verified
from outside is not one to rely on alone. Turnstile is verified by Supabase on
every auth call once enabled, which makes it the half that can be checked: send
a request without a token and it is refused.

**The code is shipped and inert until the dashboard half is done.** With no
site key, the widget does not render, no token is sent, and sign-in behaves
exactly as it does today. That is deliberate — it is the state of every fresh
clone and of CI — but it does mean _the protection is not on until someone
performs these steps._

1. **Cloudflare dashboard → Turnstile → Add widget.** Hostname: your deployment
   domain (add `localhost` too if you want it in local dev). Widget mode:
   **Managed**. You get a **site key** and a **secret key**.
2. **Supabase dashboard → Authentication → Attack Protection → Enable Captcha
   protection.** Provider: **Turnstile by Cloudflare**. Paste the **secret**
   key here. This is the only place that value goes — it is not an environment
   variable of this application and there is no entry for it in
   `.env.example`, on purpose.
3. **Deployment environment → set `NEXT_PUBLIC_TURNSTILE_SITE_KEY`** to the
   site key. It is public and compiled into the client bundle by design.
4. Redeploy. The CSP opens `frame-src https://challenges.cloudflare.com`
   automatically, and only while the key is set.

Verify it is actually on — this is the check worth doing, because steps 2 and 3
can be done independently and either alone looks fine:

```bash
# With captcha enforcement enabled, a token-less OTP request must be REFUSED.
curl -sS -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/otp"   -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"   -H "Content-Type: application/json"   -d '{"email":"probe@example.com"}'
# Expect an error mentioning captcha. A 200 here means step 2 was not applied.
```

## Sessions, tokens, and redirects

- **Identity is always validated.** Server code derives the user from
  `supabase.auth.getUser()`, which checks the JWT against the Auth server.
  `getSession()` returns whatever is in the cookie without verifying it; an
  ESLint rule (`no-restricted-syntax` in `apps/web/eslint.config.mjs`) makes
  using it for identity a build error rather than a code-review question.
- **Post-login redirects are shape-checked.** `?next=` goes through
  `safeRedirectPath`, which accepts a same-origin path and nothing else.
  `new URL(next, origin)` — the previous implementation — returns an absolute
  `next` verbatim and ignores the base, which was a live open redirect at the
  moment of highest user trust.
- **Every callback failure is explained.** Cancelled consent, a missing code,
  an expired or reused magic link, and a rejected exchange each land on
  `/login` with their own message. None of them is a 500.
- **Sign-out clears cookies**, not just client state; an e2e test asserts the
  signed-out contract returns after `POST /auth/signout`.

## Sign-in flow

1. `/login` — magic link or GitHub OAuth via `@supabase/ssr`.
2. `/auth/callback` — exchanges the code for a session and seeds the user's
   email channel so digests work with no extra setup.
3. `src/middleware.ts` refreshes the session cookie on navigation (and no-ops
   entirely when auth is unconfigured).
4. On first visit to `/settings`, a banner offers one-click import of a
   watchlist saved in `localStorage` while signed out.
