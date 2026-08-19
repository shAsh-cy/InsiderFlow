# Deploying InsiderFlow

**The command is `pnpm deploy:prod`.** Everything else in this file is the
one-time setup that makes it work, and the decisions it encodes.

```bash
pnpm deploy:prod
```

That dispatches [`.github/workflows/release.yml`](.github/workflows/release.yml).
GitHub runs the deploy; your machine never holds a production secret. The run
stops at the `production` environment and waits for you to approve it.

**One command, one click.**

```
pnpm deploy:prod
  └─ preflight ......... typecheck, lint, 9 gates, 705 unit tests, build,
     (no secrets)        client-bundle scan, image scan with planted decoys
  └─ ⏸ APPROVAL ........ the `production` environment's required reviewer
  └─ release ........... migrate → PROVE RLS → worker → web → smoke
                         → flip DEPLOYMENT_ACTIVE
     on failure ........ roll back web + worker, never flip, print the state
```

Other forms:

```bash
pnpm deploy:prod -- --ref=main                  # release a specific ref
pnpm deploy:prod -- --reason="hotfix: cursor"   # recorded in the run summary
pnpm deploy:prod -- --skip-worker               # web-only release
pnpm deploy:prod -- --dry-run-rollback          # force smoke to fail, exercise
                                                # rollback, never flip
git tag v0.2.0 && git push --tags               # the other way in
```

---

## Before the first release: one-time setup

### 1. The GitHub Environment — this is the human gate

Settings → Environments → **New environment** → `production` →
**Required reviewers** → add yourself.

Without this the pipeline does not pause and there is no approval step. The
environment is also where the deploy secrets live: GitHub does not release
them to the runner until the review is approved, which is what makes
`preflight` safe to run before it.

### 2. Vercel project

Import the repo at <https://vercel.com/new>, then **Settings → General →
Root Directory → `apps/web`**.

That is a project setting and not a flag, and the pipeline cannot set it. The
repository is uploaded from the runner and **built on Vercel's
infrastructure** — `vercel build --prebuilt` is broken for pnpm monorepos
outside Vercel's own build container (it hardcodes a PATH that does not exist
elsewhere, vercel/vercel#15204), so the pipeline never uses it.

### 3. Supabase production project

A **separate project from the dev one.** The dev project deliberately keeps
email+password enabled so `e2e/auth-isolation.spec.ts` can mint two real users
for the cross-user exploitation suite; production must not. See
[the decisions below](#the-supabase-production-decisions).

### 4. `DEPLOY_PAT`

A personal access token with permission to write repository variables — `repo`
(classic) or **Variables: write** (fine-grained). The default `GITHUB_TOKEN`
cannot, and this is what flips `DEPLOYMENT_ACTIVE` at the end of a successful
release.

---

## Where every secret goes

Four places, and the split is not arbitrary: a value goes where the thing that
reads it runs. **Nothing here is ever committed.**

### GitHub → Settings → Environments → `production` → Environment secrets

Put them on the **environment**, not the repository, so they are released only
after the approval.

| Secret                  | Value                                                              | Notes                                                                                                        |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`          | admin connection, **SESSION pooler, port 5432**                    | Migrations only. The pipeline refuses 6543 — see [the two ports](#the-two-ports).                            |
| `APP_DATABASE_URL`      | `insiderflow_app`, transaction pooler **6543**                     | Used by the RLS proof. Same value as Vercel's.                                                               |
| `APP_DB_PASSWORD`       | generated, 24 random bytes                                         | Read only by `db:app-role`. `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` |
| `VERCEL_TOKEN`          | Vercel → Account Settings → Tokens                                 |                                                                                                              |
| `VERCEL_ORG_ID`         | `.vercel/project.json` after `vercel link`, or the dashboard       | Not secret in any real sense; kept here so the CLI needs no interactive link.                                |
| `VERCEL_PROJECT_ID`     | same                                                               |                                                                                                              |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare → My Profile → API Tokens → **Edit Cloudflare Workers** | Scope it to Workers Scripts:Edit; it does not need zone access.                                              |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers → Overview                          |                                                                                                              |
| `SITE_URL`              | the public origin, e.g. `https://insiderflow.vercel.app`           | What smoke tests. See [why not the deployment URL](#why-smoke-uses-site_url).                                |
| `DEPLOY_PAT`            | PAT with Variables: write                                          | Flips `DEPLOYMENT_ACTIVE`.                                                                                   |

### GitHub → repository secrets (for the four scheduled workflows)

These are read by `analytics.yml`, `ops.yml`, `backfill.yml` and
`keepalive.yml`, which run on schedules and never see the environment.

| Secret                            | Notes                                                               |
| --------------------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`                    | admin. Each workflow no-ops with a printed notice if this is empty. |
| `EDGAR_USER_AGENT`                | SEC fair access requires a real contact address.                    |
| `TELEGRAM_BOT_TOKEN`              | the **production** bot — see [below](#a-different-telegram-bot).    |
| `OPS_TELEGRAM_CHAT_ID`            | where failures are reported.                                        |
| `SITE_URL`                        | alert links.                                                        |
| `HOUSE_PTR_URL`, `SENATE_PTR_URL` | optional; the bundled congressional sources are dead (403).         |

### Vercel → Project → Settings → Environment Variables → **Production**

| Variable                          | Value                                           | Why it must be here                                                                       |
| --------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **`DEPLOY_ENV`**                  | `production`                                    | **Load-bearing.** See [the DEPLOY_ENV trap](#the-deploy_env-trap).                        |
| **`APP_DATABASE_URL`**            | `insiderflow_app` @ transaction pooler **6543** | The request path. Without it the app refuses to serve — deliberately.                     |
| `NEXT_PUBLIC_SUPABASE_URL`        | Supabase → Settings → API                       | Compiled into the browser bundle at **build** time.                                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | Supabase → Settings → API → anon/publishable    | Public by design. **Never the service_role key, and never a `NEXT_PUBLIC_` service key.** |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`  | Cloudflare Turnstile site key                   | Public; rendered into the widget markup.                                                  |
| `SITE_URL`                        | the public origin                               | CSRF allow-list and RSS self-references.                                                  |
| `TELEGRAM_BOT_TOKEN`              | production bot                                  | The webhook replies with it.                                                              |
| `TELEGRAM_BOT_USERNAME`           | production bot                                  | Builds the `/start` deep link.                                                            |
| `TELEGRAM_WEBHOOK_SECRET`         | generated                                       | Required; the webhook fails closed without it.                                            |
| `HOUSE_PTR_URL`, `SENATE_PTR_URL` | optional                                        |                                                                                           |

The release pipeline asserts that `DEPLOY_ENV`, `APP_DATABASE_URL` and both
`NEXT_PUBLIC_*` values are present **before** it uploads, using
`vercel env ls production`, which prints names and not values.

> **There is no `TURNSTILE_SECRET` here.** The secret half of Turnstile is not
> read by this application at all — it goes into the Supabase dashboard, and
> Supabase does the verification. `apps/web/src/lib/auth/turnstile.ts` explains
> why there is deliberately no such variable: one that exists invites someone
> to fill it in.

### Cloudflare → `wrangler secret put <NAME>`

Run from `ingestion/edgar-worker`. Only the first two are required; each of the
rest unlocks one feature.

| Secret                                                | Notes                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `DATABASE_URL`                                        | **transaction pooler 6543** — the worker is a runtime, not a migration. |
| `EDGAR_USER_AGENT`                                    | required by SEC fair access.                                            |
| `SITE_URL`                                            | alert email links.                                                      |
| `TELEGRAM_BOT_TOKEN`                                  | the production bot.                                                     |
| `RESEND_API_KEY`, `RESEND_FROM`                       | optional; digest email.                                                 |
| `FINNHUB_API_KEY`, `FMP_API_KEY`, `WATCHLIST_SYMBOLS` | optional adapters.                                                      |
| `INDIA_FEED_URL`                                      | optional; a **licensed** feed only.                                     |

### Supabase dashboard (production project)

| Setting                                                | Value                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| Authentication → Attack Protection → Turnstile secret  | the Cloudflare **secret** key                                     |
| Authentication → Providers → Email                     | see [the decisions](#the-supabase-production-decisions)           |
| Authentication → Providers → Email → **Confirm email** | **ON** (it is off on dev only)                                    |
| Authentication → URL Configuration → Site URL          | the production origin                                             |
| Authentication → URL Configuration → Redirect URLs     | `<origin>/auth/callback` — **keep the localhost entries** for dev |

---

## The two ports

The single most expensive thing to get wrong here, because getting it wrong
does not fail — it **hangs**.

| Connection                                    | Port     | Mode        | Used for                                                                              |
| --------------------------------------------- | -------- | ----------- | ------------------------------------------------------------------------------------- |
| Direct — `db.<ref>.supabase.co`               | 5432     | session     | nothing, from CI: **IPv6-only** without the IPv4 add-on, and Actions runners are IPv4 |
| **Session pooler** — `<region>.pooler...`     | **5432** | session     | **migrations** (`DATABASE_URL`)                                                       |
| **Transaction pooler** — `<region>.pooler...` | **6543** | transaction | **runtime** (`APP_DATABASE_URL`, worker), `prepare: false`                            |

The transaction pooler has been transaction-mode-only since 2025-02-28. It
holds no session state, so `drizzle-kit migrate` sits there until the job times
out — 45 minutes after a human approved the release.

`scripts/assert-session-pooler.mjs` runs before the migration and refuses 6543
outright. It prints the port and a host _shape_ and nothing else: the value it
reads is an admin credential and the run log is public.

---

## The `DEPLOY_ENV` trap

r20 made the RLS hard-fail arm on a **declaration** rather than on
`NODE_ENV`, because `next build` sets `NODE_ENV=production` for every
production build — the Docker image, the Playwright harness, CI — none of
which deploys anything.

The mirror of that decision: **the one build where the gate must arm has to
declare itself.** And because the web app is built on Vercel's infrastructure,
nothing the release workflow puts in `env:` reaches that build. `DEPLOY_ENV`
has to be a Vercel production environment variable.

If it is missing, `NODE_ENV` decides and the gate still arms (fail-closed). If
it is set to anything other than `production`, **it does not** — and nothing
complains at build time. That is why the pipeline asserts its presence before
uploading, and why smoke asserts the app is serving data afterwards: `getDb()`
throws on a fatal verdict, so a 200 with rows on `/api/trades` proves the
connection was made.

---

## The Supabase production decisions

### Email provider: **OFF**. GitHub OAuth only.

The dev project keeps email+password **on**, deliberately, so
`e2e/auth-isolation.spec.ts` can mint two real users and try to cross the
boundary between them in both directions. That suite is the reason the RLS
design is trusted, and it needs real users.

Production is a different question. A password is a credential to phish, to
stuff from a breach list, to reset over email, and to store — bought for
nothing, on a product whose accounts exist only to sync a watchlist. So the
provider is off and sign-in is GitHub OAuth.

> **The dashboard has one switch for both.** "Enable email provider" controls
> passwords **and** magic links. If you want magic links, the provider must be
> ON — and then the control that matters is that no part of the UI offers a
> password field. `e2e/auth-providers.spec.ts` asserts exactly that, three
> ways (by `type`, by `name`, by `autocomplete`), plus that the copy never
> mentions one. Smoke re-checks it against the live page.
>
> Choose one, then tell the tooling which you chose:
>
> ```bash
> pnpm smoke:prod -- --base=https://<origin> --expect-password=no
> ```

### Confirm email: **ON** in production

Off on dev only, so the isolation suite's `signUp` returns a session
immediately.

### Verify it with a request, not with the dashboard

A dashboard toggle is a claim. The request is the check:

```powershell
.\scripts\verify-windows.ps1 `
  -BaseUrl https://<your-origin> `
  -SupabaseUrl https://<prod-ref>.supabase.co `
  -SupabaseAnonKey sb_publishable_... `
  -EmailProvider off
```

`-EmailProvider off` expects sign-up to be **refused as unsupported**;
`-EmailProvider magic-link` expects it to be refused by the **captcha**. Either
way a `200` is the failure. See [docs/verify-windows.md](docs/verify-windows.md)
for why `curl` and `Invoke-RestMethod` cannot be used for this on Windows —
both can print nothing, and nothing reads as success.

### A different Telegram bot

Production gets a **fresh** bot token, never one that has been in a chat, a
screenshot or a terminal. `/revoke` then `/token` in @BotFather.
[docs/security.md](docs/security.md) treats a credential as burned the moment
it is visible anywhere but a secret store.

### `APP_DATABASE_URL`, the role, and the blocking gate

The web app connects as `insiderflow_app` — `NOBYPASSRLS` — so the
`FORCE ROW LEVEL SECURITY` policies on the four user tables apply to every
request. The release pipeline creates the role and then **proves** enforcement
before anything is user-visible:

```
db:app-role                → refuses if the role ends up SUPERUSER/BYPASSRLS
db:bootstrap -- --check    → no context → 0 rows
                             owner context → 1 row
                             other user → 0 rows
```

**The deploy aborts on `rls_not_enforced` or `rls_not_proven`.** It is not a
reimplementation — it is the same command the local stack and CI run.

> **Supavisor routes by username.** The pooled connection string for the
> application role is `insiderflow_app.<project-ref>`, not a bare
> `insiderflow_app`. `packages/db/scripts/app-role.mjs` prints a suggested
> string that swaps only the username, so **its suggestion is wrong for
> Supabase**. Build `APP_DATABASE_URL` by hand.

---

## Why smoke uses `SITE_URL`

Every `vercel deploy` also mints a unique per-deployment hostname. Smoking that
one proves the build works and proves nothing about the domain visitors reach
— the alias, the redirect and the certificate all live on the other name. So
smoke targets `SITE_URL` when it is set, and falls back to the deployment URL
when it is not.

---

## Rollback

Automatic on any failure after the deploy, and the flip never happens on a
failed run.

|                     | On failure                                                                |
| ------------------- | ------------------------------------------------------------------------- |
| web                 | `vercel rollback <previous>` — the URL is captured before the deploy      |
| worker              | `wrangler rollback <version>` — the version is captured before the deploy |
| migrations          | **not reverted.** See below.                                              |
| `DEPLOYMENT_ACTIVE` | never flipped                                                             |

Migrations are not auto-reverted, and that is a decision. An automatic
down-migration against a production database, on a code path that only runs
when something has already gone wrong, is a worse risk than the forward state.
Every migration in this project is additive, so the previous web build runs
against the new schema. If one ever is not, that release needs a human — and
the run summary says so instead of leaving it to be assumed.

Exercise the whole failure path without breaking anything:

```bash
pnpm deploy:prod -- --dry-run-rollback
```

That forces smoke to fail against an unreachable host, so rollback runs and
`DEPLOYMENT_ACTIVE` is not flipped.

---

## After a successful release

`DEPLOYMENT_ACTIVE=true` is set by the pipeline, which arms four scheduled
workflows — nightly analytics, ops (ops-check + digest), backfill (reconcile +
backfill), and the Supabase keep-alive. Each still guards on its own secret
being non-empty and reports "nothing to do" rather than failing.

Then run the manual gate, which is the one thing the pipeline cannot do for
itself — a request from outside GitHub's network, on Windows, where both
obvious tools can print nothing:

```powershell
.\scripts\verify-windows.ps1 -BaseUrl https://<your-origin> `
  -SupabaseUrl https://<prod-ref>.supabase.co -SupabaseAnonKey sb_publishable_...
```

The **keep-alive is the most load-bearing workflow in the repository** for a
free-tier deployment: Supabase pauses free projects after 7 idle days, a paused
project answers HTTP 540, and it stays down until someone clicks Restore. Two
touches a week reset that timer.
