# Quickstart

Two paths. Pick one.

- **[Run it locally](#local)** — one command, working product with data, ~3 minutes.
- **[Deploy it free](#deploy)** — Vercel + Supabase + Cloudflare, all free tiers, ~30 minutes.

Only two environment variables are ever _required_: `DATABASE_URL` and
`EDGAR_USER_AGENT`. Everything else is optional with a documented fallback —
the app runs as a fully public, read-only site with no auth, no alerts, and no
third-party API keys.

---

<a id="local"></a>

## 1. Run it locally

**Prerequisites:** Docker, and that is all.

```bash
git clone https://github.com/insiderflow/insiderflow.git
cd insiderflow
docker compose up
```

Open <http://localhost:3000>.

That builds the app, starts Postgres, runs every migration, seeds sample data,
**runs the offline analytics pass**, and serves the site. You get a working
product immediately: trades, a screener with all seven presets returning rows,
company and insider pages, the leaderboard, a heatmap, congressional
disclosures, and a status page.

The analytics step is a one-shot container between the seed and the web app.
It is not optional: `cluster_flags`, `insider_scores`, and `company_anomalies`
are derived tables that migrations and the seed leave empty, and three surfaces
— the `cluster-buys` and `unusual-flow` presets, and the leaderboard — read
nothing else. It runs only the steps that need no network, so a first run never
depends on EDGAR, Stooq, or the congressional feeds being reachable.

**Everything seeded is synthetic** and lives in the reserved `ZZ*` ticker
namespace, with obviously fictional people. No fabricated filing is ever
attributed to a real company or a real person — a screenshot of this app should
never be mistakable for a real disclosure.

Aggregate pages (heatmap, leaderboard, anomaly rankings) normally _exclude_ that
namespace for exactly that reason, which would leave a seeded stack showing
empty charts. So `docker-compose.yml` sets `INSIDERFLOW_SHOW_SYNTHETIC=true`,
and those pages then label themselves as containing seed data. **Never set that
variable in production** — the default is off everywhere else.

### Getting real data

The seed has no real filings in it. To ingest live SEC data:

```bash
# The SEC requires a descriptive User-Agent with a real contact address.
export EDGAR_USER_AGENT="YourName/0.1 (you@example.com)"
docker compose --profile live up
```

The ingest container then polls EDGAR every 60 seconds. Within a couple of
minutes `/trades` shows real filings. Or backfill history in one shot:

```bash
docker compose run --rm ingest pnpm backfill --days=30 --forms=4
```

### Developing on the host

Docker is convenient for a first run; hot reload is better for actual work.

```bash
docker compose up -d postgres          # database only
pnpm install
export DATABASE_URL='postgres://postgres:postgres@localhost:5433/insiderflow'
pnpm db:migrate && pnpm seed
pnpm dev                               # http://localhost:3000
```

Run the ingestion worker in a second terminal:

```bash
cd ingestion/edgar-worker
cp .dev.vars.example .dev.vars         # then edit EDGAR_USER_AGENT
pnpm dev --test-scheduled
curl "http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*"   # fire one tick
```

### Running the auth E2E

`e2e/auth-isolation.spec.ts` mints two real users and tries to cross the
boundary between them in both directions. It needs a stack that has auth
configured **and** connects as the RLS-bound role, so it skips loudly on the
default read-only stack rather than passing without asserting anything.

```bash
export NEXT_PUBLIC_SUPABASE_URL='https://<ref>.supabase.co'
export NEXT_PUBLIC_SUPABASE_ANON_KEY='<anon key>'
docker compose up --build -d          # both values reach the build AND the runtime

cd apps/web
PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test e2e/auth-isolation.spec.ts
```

The Supabase project needs **email + password sign-up enabled with email
confirmation off** (Authentication → Providers → Email), otherwise `signUp`
returns no session and the suite skips with that reason on stdout. Use a
development project: the suite creates users.

`--build` is not optional the first time. `NEXT_PUBLIC_*` values are compiled
into the browser bundle, so an image built without them serves a page that
claims auth is configured on the server and unconfigured after hydration.

Useful commands:

| Command                        | What it does                                              |
| ------------------------------ | --------------------------------------------------------- |
| `pnpm seed -- --reset`         | Wipe and re-seed synthetic data (never touches real rows) |
| `pnpm analytics:nightly`       | Clusters, sectors, scoring, anomalies, PTR ingestion      |
| `pnpm db:bootstrap -- --check` | Verify schema, RLS, extensions without migrating          |
| `pnpm test`                    | Unit + integration suites (PGlite, no external services)  |
| `pnpm test:e2e`                | Playwright, against a running build                       |

---

<a id="deploy"></a>

## 2. Deploy it free

Three services, all on free tiers, no credit card required for any of them.

| Service                | Runs                     | Free tier                                                 |
| ---------------------- | ------------------------ | --------------------------------------------------------- |
| **Supabase**           | Postgres + auth          | 500 MB database, 50k monthly active users                 |
| **Vercel**             | Next.js app              | 100 GB bandwidth/month, hobby projects                    |
| **Cloudflare Workers** | Ingestion + alerts cron  | 100k requests/day, 5 cron triggers                        |
| **GitHub Actions**     | Nightly jobs, keep-alive | 2,000 minutes/month on private repos, unlimited on public |

When and why you would ever pay is in [SCALING.md](../SCALING.md), with the
trigger and the monthly cost for each.

> **Rotate anything that has ever been in a chat, a commit, a screenshot, or a
> terminal you shared.** Treat a credential as burned the moment it is visible
> anywhere but a secret store. In particular, generate a _fresh_ Telegram bot
> token for production rather than reusing the one you tested with locally —
> `/revoke` then `/token` in @BotFather.

### Step 1 — Supabase (database)

1. Create a project at <https://supabase.com/dashboard>. Choose a region near
   your users and save the database password.
2. **Settings → Database → Connection string → Transaction pooler.** Copy that
   URI. It looks like:

   ```
   postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```

   Use the **transaction pooler** (port 6543), not the direct connection.
   Serverless functions and Workers open many short-lived connections; the
   direct port exhausts its limit quickly. The whole codebase is pooler-safe
   (`prepare: false`, `max: 1`).

3. Run the migrations from your machine:

   ```bash
   export DATABASE_URL='<the pooler URI>'
   pnpm install
   pnpm db:bootstrap
   ```

   `db:bootstrap` migrates and then _verifies_: every table present, row-level
   security enabled with policies on all four user-scoped tables, `pg_trgm`
   installed, the scanner seed row created. It exits non-zero if any of that is
   wrong, so a half-applied schema fails loudly instead of at 3am.

   It does **not** seed. Synthetic rows do not belong in production.

### Step 2 — Vercel (web app)

1. Import the repository at <https://vercel.com/new>. Vercel detects Next.js;
   leave the build settings alone. Set **Root Directory** to `apps/web`.
2. Add environment variables (Settings → Environment Variables):

   | Variable                        | Value                                                      |
   | ------------------------------- | ---------------------------------------------------------- |
   | `DATABASE_URL`                  | the Supabase pooler URI                                    |
   | `SITE_URL`                      | your production URL, e.g. `https://insiderflow.vercel.app` |
   | `NEXT_PUBLIC_SUPABASE_URL`      | Supabase → Settings → API → Project URL                    |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public key                |

   Auth variables are optional. Omit them and the site runs read-only with no
   sign-in chrome — a deliberate, supported mode, not a broken one.

3. Deploy, then verify edge caching is live:

   ```bash
   curl -sI https://<your-app>/api/trades?limit=1 | grep -iE 'cache-control|etag|x-vercel-cache'
   # cache-control: public, max-age=0, s-maxage=60, stale-while-revalidate=300
   # etag: W/"..."
   # x-vercel-cache: MISS      ← HIT on the second request

   curl -sI https://<your-app>/ | grep -i cache-control
   # cache-control: private, no-cache, no-store, max-age=0, must-revalidate
   ```

   A second call to the same API URL should report `x-vercel-cache: HIT`. If it
   does not, check that you have not set `Cache-Control` overrides in
   `vercel.json`.

   The HTML line matters as much as the API one. Locale and session both live
   in cookies, so page HTML must never be storable by a shared cache — if you
   ever see `s-maxage` on an HTML response, one visitor's Hindi or signed-in
   page can be served to the next. `private, no-store` is what prevents it (a
   `Vary: Cookie` header would not: Next rewrites `Vary` to its RSC negotiation
   headers). An e2e test asserts this, so it cannot regress silently.

### Step 3 — Supabase Auth (optional, for accounts)

Skip this entirely if you do not want accounts.

1. **Authentication → URL Configuration**
   - **Site URL:** `https://<your-app>`
   - **Redirect URLs:** add both `https://<your-app>/auth/callback` and
     `http://localhost:3000/auth/callback`, so local development keeps working.
2. **Authentication → Providers → GitHub**, then in GitHub create an OAuth app
   with callback `https://<ref>.supabase.co/auth/v1/callback`.

   **Use a separate GitHub OAuth app for production.** Sharing one app between
   local and production means a leaked development secret is a production
   compromise, and you cannot revoke one without breaking the other. The
   Supabase callback URL itself does not change between environments.

### Step 4 — Cloudflare Worker (ingestion + alerts)

```bash
cd ingestion/edgar-worker
pnpm exec wrangler login
pnpm exec wrangler secret put DATABASE_URL      # the pooler URI
pnpm exec wrangler secret put EDGAR_USER_AGENT  # "YourApp/1.0 (you@example.com)"
pnpm exec wrangler secret put SITE_URL          # https://<your-app>
pnpm exec wrangler deploy
```

Optional secrets, each unlocking one feature: `TELEGRAM_BOT_TOKEN` (alerts —
see [alerts.md](alerts.md)), `RESEND_API_KEY` + `RESEND_FROM` (email digests),
`FINNHUB_API_KEY`, `FMP_API_KEY`, `WATCHLIST_SYMBOLS`.

The worker uses **2 of Cloudflare's 5 free cron triggers**:

| Cron        | Does                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `* * * * *` | EDGAR ingest → cluster flags → alert scan → instant dispatch → secondary sources → price context |
| `0 * * * *` | Digest flush (hourly, so each user's local digest hour is honoured)                              |

Cluster maintenance is folded into the 1-minute run rather than given its own
trigger — it is O(rows since its cursor), so it costs nothing on a quiet
minute. Everything without a 60-second deadline runs on GitHub Actions instead.

Verify:

```bash
curl https://<worker>.workers.dev/           # {"status":"ok","lastRun":{...}}
pnpm exec wrangler tail                      # watch a live cron tick
```

### Step 5 — GitHub Actions (scheduled jobs)

Add these repository secrets (Settings → Secrets and variables → Actions):

| Secret                          | Needed by                        | Required? |
| ------------------------------- | -------------------------------- | --------- |
| `DATABASE_URL`                  | every workflow                   | **yes**   |
| `EDGAR_USER_AGENT`              | backfill, nightly SIC enrichment | **yes**   |
| `TELEGRAM_BOT_TOKEN`            | digest backstop, ops alerts      | optional  |
| `OPS_TELEGRAM_CHAT_ID`          | ops alerts                       | optional  |
| `RESEND_API_KEY`, `RESEND_FROM` | digest backstop                  | optional  |
| `SITE_URL`                      | links inside alert emails        | optional  |

Four workflows then run on their own:

| Workflow              | Schedule          | Purpose                                                                     |
| --------------------- | ----------------- | --------------------------------------------------------------------------- |
| `keepalive.yml`       | Sun + Wed         | **Stops Supabase pausing the project.** See below.                          |
| `analytics.yml`       | nightly 03:20 UTC | SIC→sector, PTR ingestion, price history, scoring, anomalies, cluster sweep |
| `ops.yml` (digest)    | daily 23:40 UTC   | Digest backstop for hours the worker missed                                 |
| `ops.yml` (ops-check) | every 6h          | Telegram ping when a job is behind                                          |
| `backfill.yml`        | manual            | Load historical filings                                                     |

> **Do not disable `keepalive.yml`.** Supabase pauses free projects after 7
> consecutive idle days; a paused project answers HTTP 540 and stays down until
> someone clicks Restore in the dashboard. A low-traffic deployment dies about a
> week after launch without this, and the first person to notice is a visitor.
> Two pings a week means one can fail outright and the timer still never
> expires. It is a harmless no-op on paid plans and on non-Supabase Postgres.

### Step 6 — Verify the whole thing

```bash
curl -s https://<your-app>/api/health | jq '{status, ingestRunAgeSeconds, sources}'
```

Then open `https://<your-app>/status` — live ingestion lag, per-source
freshness, and alert-pipeline state, all computed from the data rather than
from heartbeats.

Within a few minutes of the worker's first tick you should see filings on
`/trades`. If not, `pnpm exec wrangler tail` shows exactly which stage failed.

---

## Troubleshooting

**`/trades` is empty.** The worker only ingests filings published _after_ it
starts. Run a backfill (Actions → Backfill → Run workflow) or wait for market
hours — EDGAR publishes on business days only.

**HTTP 540 from the database.** Supabase paused the project. Restore it in the
dashboard, then check why `keepalive.yml` has not been running.

**Alerts save but never arrive.** Check `/status` for scanner lag, then confirm
the rule's mode. A rule with `email` in its channels batches into the daily
digest by design; a Telegram-only rule fires instantly. Details in
[alerts.md](alerts.md).

**`prepared statement "s1" already exists`.** You are on the direct Postgres
connection, not the transaction pooler. Switch `DATABASE_URL` to the port-6543
pooler URI.

**Worker deploy fails with a `node:` import error.** `nodejs_compat` must be in
`compatibility_flags` — it already is in the committed `wrangler.jsonc`; check
you have not overridden it.

**The seed script refuses to run.** It refuses any `DATABASE_URL` that does not
look local, because synthetic filings must never reach a shared database. That
guard is working as intended.
