# InsiderFlow

[![CI](https://github.com/insiderflow/insiderflow/actions/workflows/ci.yml/badge.svg)](https://github.com/insiderflow/insiderflow/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

**Open-source, real-time, multi-market insider-trading tracker.**

> ## ⚠️ NOT INVESTMENT ADVICE
>
> InsiderFlow republishes public regulatory filings for **research and education only**. Nothing
> in this project — data, classifications, alerts, or UI — is investment advice, a
> recommendation, or an offer to buy or sell any security. Filings can be late, amended,
> incomplete, or wrong, and insider activity is not a reliable predictor of returns. **Do your
> own research and consult a licensed professional before making investment decisions.** The
> authors and contributors accept no liability for decisions made using this software or its
> data.

## Vision

When a CEO buys a million dollars of their own stock, that fact is public — but buried in
regulatory filings that most people never read. InsiderFlow watches those filings in real time,
normalizes them into one clean multi-market schema, and makes them searchable, followable, and
alertable. Open source (AGPL-3.0), free-tier deployable end to end, and owned by nobody.

**Today**: SEC EDGAR Forms 3/4/5 ingestion (US), congressional STOCK Act disclosures, watchlists,
Telegram/email alerts, and a published-methodology analytics layer — insider clusters, forward-return
scoring, sector classification, and net-flow anomaly detection. **Planned**: more filing types
(13D/G) and more markets (see the legal notes below).

Every derived number is computed by a formula published at [`/docs/methodology`](/docs/methodology).
There is no proprietary model, and none of it is investment advice.

## What is verified, and what is only claimed

Read this before the feature list. Every row says how it was checked and when — a
row with no measurement behind it says so, because "not measured" and "passed"
are different facts and this project has confused them before.

Live at [`/status`](/status) and `/api/health`, with per-source timestamps. A
source that has never produced a row reads **never**, not `0`.

| Source                              | State                     | How that was established                                                                                                       |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **SEC EDGAR (US)**                  | Live                      | Ingested from live EDGAR on 2026-08-15: 25 filings discovered, 21 ingested, 71 transactions, 44.5s wall clock                  |
| **Congressional (STOCK)**           | Upstream dead             | Pipeline built and tested; the house/senate-stock-watcher S3 buckets answer **403**. Produces nothing. Env-swappable           |
| **NSE India — SAST, bulk, pledges** | Self-host only, confirmed | Live smoke from a residential Indian line, 2026-08-18: 1,334 / 70 / 1,693 rows, field names recorded                           |
| **NSE India — PIT**                 | Self-host only, confirmed | 2026-08-19: the endpoint had been RETIRED, not blocked. `corporates-pit-gg` returns 169 filings/week; field names now recorded |
| **BSE India**                       | Self-host only, confirmed | Announcements returned 50 rows; metadata and PDF links only, never structured numbers. 1 of 2 attempts failed on a bad header  |
| **Finnhub, FMP**                    | Optional, keyed           | Adapters tested against recorded payloads; not exercised live in this round                                                    |
| **EU MAR, SEDI**                    | Stub                      | Normalizer shape only. No feed                                                                                                 |

### Latency: three numbers, and only one of them is ours

`pnpm measure:edgar-latency` measures this against live EDGAR rather than
asserting it. It separates terms that were previously added together:

- **Dissemination** — EDGAR acceptance to public feed. **Theirs.** Filings accepted
  after 17:30 ET disseminate the _next business morning_, so this term is
  occasionally twelve hours and never ours. Reported, never asserted on.
- **Detection** — public feed to queryable row. **Ours**, gated at 180s. **Not yet
  measured**: measuring it requires watching a filing arrive, and the 420s watch
  window on 2026-08-15 at 07:20 ET saw no new Form 4. The script exits 2 and says
  so rather than printing a number nobody produced.
- **Pipeline** — run start to queryable row: **44.5s measured**, for 25 filings.

The figure this section used to carry — "60–90 seconds from EDGAR acceptance" —
was arithmetic, not a measurement, and it added a term belonging to the SEC to two
of ours.

### Known defects, stated rather than filed away

- **The SSE cursor is floored to a millisecond** while `created_at` keeps
  microseconds, so the newest row re-qualifies on every 2.5s poll tick — measured
  at **ten deliveries of one row inside a single 25s window**, and again on
  reconnect. The shipped web client dedupes by trade id and shows nothing twice;
  an API consumer polling `?mode=poll` receives the tail row on every poll. The
  fix belongs in `fetchSince`, which both paths share. Pinned by a deliberately
  failing test in `apps/web/e2e/stream-resume.spec.ts`.
- **NSE bulk deals and pledges ignore their date window** — identical row counts
  for a 7-day and a 90-day request. `--days` does not bound them; schema-level
  dedup is what makes a repeat run harmless.
- **`/screener` regressed 14 points on mobile Lighthouse** — 76 at r4, 62 today,
  bimodal across runs (57–76 on an unchanging build). Script evaluation and
  hydration, not the server: TTFB is 62ms and 286 kB of First Load JS evaluates
  for ~1.9s throttled. Diagnosed but not fixed, with the attribution that is
  still a hypothesis named as one — [docs/performance.md](docs/performance.md).
- **A retired endpoint here returns `200` with an empty envelope, not `404`.**
  NSE's `corporates-pit` did exactly that, and this project read it as an IP
  block for three rounds. The smoke now probes it permanently as a control. Any
  source that can answer "nothing" and "nothing, because I no longer exist"
  with the same bytes needs one.

### Blocking before this deployment is public

Also carried on [`/status`](/status), because a checklist is read once and a status
page is read whenever something looks wrong.

| Step                                        | State                                                             |
| ------------------------------------------- | ----------------------------------------------------------------- |
| Cloudflare Turnstile enabled in Supabase    | Code shipped, **dashboard step pending**                          |
| Production email+password provider disabled | **Pending** — this process cannot read the setting                |
| RLS verified against the real Supabase      | Implemented and tested on PGlite; **deploy-verification pending** |

`SECURITY_CHECKLIST.md` item 13 records "N/A — prod has no password login". That
becomes true when the provider is actually disabled, and not before.

### What "real time" means here, precisely

Through the cached API or the SSE stream, allow roughly two minutes end to end.

**Bursts drain, they do not vanish.** EDGAR Form 4 volume clusters heavily after the US close, and
a run fetches at most `MAX_FILINGS_PER_RUN` (default 25) filings. Everything discovered beyond
that is written to a queue and drained oldest-first on later ticks, so 200 filings arriving in one
minute take about 8 minutes to land in full — the last of them, not the first. The queue depth and
the age of the oldest waiting filing are on [`/status`](/status) and `/api/health`, and a nightly
job reconciles the live path against EDGAR's authoritative daily index and reports anything it
missed.

That queue is the fix for a real defect: discovery used to be inseparable from processing, so
whatever a run could not fetch was forgotten, and under sustained load the oldest unprocessed
filings scrolled out of EDGAR's 100-item feed window permanently. See
[docs/architecture.md](docs/architecture.md).

## Architecture

```mermaid
flowchart LR
    subgraph sources["Data sources"]
        EDGAR["SEC EDGAR<br/>Forms 3/4/5 · public domain"]
        PTR["STOCK Act PTRs<br/>congressional disclosures"]
        MKT["Stooq closes · ECB FX<br/>keyless, cached"]
        NSE["NSE / BSE<br/>off by default · licence-restricted"]
    end

    subgraph ingestion["Ingestion — free tiers"]
        WORKER["Cloudflare Worker<br/>cron 1 min: ingest → clusters<br/>→ alert scan → dispatch"]
        GHA["GitHub Actions<br/>nightly: SIC · PTR · prices<br/>· scoring · anomalies"]
    end

    subgraph data["Data — Supabase (free)"]
        PG[("Postgres · Drizzle<br/>core + derived + user tables<br/><i>RLS on user data</i>")]
    end

    subgraph app["App — Vercel (free)"]
        WEB["apps/web<br/>Next.js 15 · RSC · Tailwind<br/>pages · API · SSE · /status"]
    end

    subgraph alerts["Delivery"]
        TG["Telegram — primary<br/>free, unlimited"]
        RESEND["Resend email<br/>100/day → daily digest"]
    end

    EDGAR -->|poll Atom feed| WORKER
    MKT --> WORKER
    PTR --> GHA
    MKT --> GHA
    NSE -.->|self-host only| PG
    WORKER -->|upsert| PG
    GHA -->|derived tables| PG
    PG -->|shared query layer| WEB
    WORKER --> TG
    WORKER --> RESEND
```

Full diagram and the invariants behind it: **[docs/architecture.md](docs/architecture.md)**.

### Source adapters

Every market plugs in through one `SourceAdapter` (`packages/core/src/adapters/`):
`fetch()` pulls raw payloads, `normalize()` maps them into a `UnifiedTransaction`
(unified role flags, SEC-derived code taxonomy, native currency + USD via FX, and a
routine-vs-opportunistic `relevance` label). Persistence resolves entities across
sources and drops cross-source duplicates on a `(company, insider, date, shares, code)`
dedup key. **Adding a market = implementing one adapter — no schema change.**

| Adapter   | Market | Status                                             | Free-tier budget       |
| --------- | ------ | -------------------------------------------------- | ---------------------- |
| `edgar`   | US     | Live (primary, filing-based)                       | SEC fair-access policy |
| `finnhub` | US     | Optional — insider transactions + sentiment (MSPR) | 60 calls/min           |
| `fmp`     | US     | Optional — insider trading endpoint                | ~250 calls/day         |
| `nse-bse` | IN     | Normalizer ready; needs a licensed feed (legal ↓)  | n/a                    |
| `eu-mar`  | EU     | Stub — needs a commercial aggregator               | n/a                    |
| `sedi`    | CA     | Stub — needs a commercial aggregator               | n/a                    |

FX (Frankfurter/ECB) and daily price context (Stooq) are keyless and cached in
Postgres; API responses are cached in `api_cache` so free-tier budgets are never
spent twice.

### Public API

Free and rate-limited: 60 requests/min per IP, or 600/min with an `x-api-key`
(set `API_KEYS` in the web app's environment). Docs at [`/docs`](/docs), spec at
`/api/openapi.json`. Responses carry edge-cache headers (`s-maxage` +
`stale-while-revalidate`) and ETags; all inputs are Zod-validated.

| Endpoint                           | What it returns                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/api/trades`                      | Normalized trades — filter by market, ticker, code, role, relevance, source, min_value(_usd), cluster, dip, exec_only, from/to |
| `/api/companies/:ticker`           | Profile, 90-day aggregates, insider sentiment (MSPR), trade-vs-close price context                                             |
| `/api/companies/:ticker/sentiment` | MSPR time series                                                                                                               |
| `/api/insiders/:id`                | Insider profile + recent trades                                                                                                |
| `/api/screener/:preset`            | Canned screens: big-buys, cluster-buys, exec-buys, dip-buys, unusual-flow, ...                                                 |
| `/api/heatmap`                     | Net USD flow, grouped by company / sector / country, with a timeframe                                                          |
| `/api/leaderboard`                 | Insider performance vs SPY — informational, formulas at `/docs/methodology`                                                    |
| `/api/politicians`                 | Congressional STOCK Act disclosures — amounts are ranges, never point values                                                   |
| `/api/rss/:screen`                 | RSS 2.0 feed of any screen (every preset has one)                                                                              |
| `/api/rss/politicians`             | RSS 2.0 feed of congressional disclosures, same filters as the JSON endpoint                                                   |
| `/api/stream`                      | SSE live feed — ~25s serverless windows, Last-Event-ID resume, `?mode=poll` fallback                                           |

Form 4/A amendments supersede their originals and are hidden by default
(`include_superseded=true` to opt back in).

### Analytics

Derived tables are rebuilt from `transactions` + `daily_prices` and can be dropped at any time. All
formulas are published at [`/docs/methodology`](/docs/methodology).

| Signal            | What it is                                                                                        | Maintained by                     |
| ----------------- | ------------------------------------------------------------------------------------------------- | --------------------------------- |
| Insider clusters  | ≥2 distinct insiders trading the same way in a rolling 14-day window, anchored to the first trade | 1-min ingest cron + nightly sweep |
| Sectors           | Derived from EDGAR SIC codes; unmapped codes stay _unclassified_ rather than guessed              | Nightly (rate-limited, ≤5 req/s)  |
| Performance score | 30/90/180-day excess return vs SPY, signed by direction, shrunk toward zero by sample size        | Nightly                           |
| Anomaly score     | Net flow vs a company's OWN trailing baseline (z-score); withheld when the baseline is too thin   | Nightly                           |

Cluster detection reads precomputed flags by default. Self-hosters running only the web app can set
`INSIDERFLOW_CLUSTER_SOURCE=sql` to compute the same set at query time — a parity test asserts the
two paths agree on labelled fixtures.

Congressional disclosures come from the open house/senate-stock-watcher datasets, with a link to the
original PTR on every row. STOCK Act amounts are **ranges**, so the schema models `amountMin`/
`amountMax` and never synthesises a midpoint — see [`docs/politicians.md`](docs/politicians.md).

### Monorepo layout

```
insiderflow/
├── apps/
│   └── web/                 # Next.js 15 (App Router, RSC, Tailwind CSS, next-intl en/hi)
├── packages/
│   ├── core/                # Shared types, normalization, SEC codes, SIC→sector, PTR parsing
│   ├── db/                  # Drizzle ORM schema + Postgres client + shared trade filters
│   ├── alerts/              # Cursor-driven scanner, matcher, Telegram/Resend dispatch
│   └── analytics/           # Clusters, scoring, anomalies, sector + PTR ingestion jobs
├── ingestion/
│   ├── edgar-worker/        # Cloudflare Worker: EDGAR cron ingestion + alert pipeline
│   └── india-local/         # Optional, off-by-default NSE/BSE scrape runner
└── .github/workflows/       # CI + nightly analytics
```

Cron budget: the worker's two free triggers are already spent (1-minute ingest + alert scan,
hourly digest), so cluster maintenance rides the 1-minute run — it is O(rows since the cursor) —
and everything without a 60-second SLA runs on a nightly GitHub Actions schedule.

## Getting started

**One command, working product with data:**

```bash
git clone https://github.com/insiderflow/insiderflow.git && cd insiderflow
docker compose up          # Postgres + migrations + seed + web on :3000
```

Seeded data is entirely synthetic and lives in the reserved `ZZ*` ticker
namespace — no fabricated filing is ever attributed to a real company or person.
To ingest real SEC data, set `EDGAR_USER_AGENT` and run
`docker compose --profile live up`.

**Developing on the host** (hot reload):

```bash
pnpm install
docker compose up -d postgres
export DATABASE_URL='postgres://postgres:postgres@localhost:5433/insiderflow'
pnpm db:migrate && pnpm seed && pnpm dev

# ingestion worker, in another terminal (1-min cron via --test-scheduled)
pnpm --filter @insiderflow/edgar-worker dev

# backfill the last 30 days of Form 4 filings from the EDGAR full-index
pnpm backfill -- --days=30 --forms=4
```

Copy `.env.example` → `.env` and `ingestion/edgar-worker/.dev.vars.example` → `.dev.vars`.
Only `DATABASE_URL` and `EDGAR_USER_AGENT` are required; `.env.example` documents every other
variable, its default, and which runtime consumes it.

Quality gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Free-tier deployment

The entire stack runs on free tiers — **no paid services required, no credit card**:

| Piece           | Service            | Free tier that matters                          |
| --------------- | ------------------ | ----------------------------------------------- |
| Web app         | Vercel Hobby       | 100 GB bandwidth/month, Next.js + RSC           |
| Database        | Supabase Free      | 500 MB Postgres + transaction pooler + auth     |
| Ingestion       | Cloudflare Workers | 100k requests/day, 5 cron triggers (we use 2)   |
| Scheduled jobs  | GitHub Actions     | Nightly analytics, digests, Supabase keep-alive |
| Email alerts    | Resend             | 100 emails/day → batched into one daily digest  |
| Telegram alerts | Telegram Bot API   | Free and unlimited — the primary channel        |

**→ [docs/quickstart.md](docs/quickstart.md) walks the whole deploy, step by step.**

⛔ The reference deployment is **paused before Part 2** — read [DEPLOYMENT_STATE.md](DEPLOYMENT_STATE.md) before running any deploy command.

> ⚠️ Supabase pauses free projects after **7 idle days** (HTTP 540, manual restore).
> `.github/workflows/keepalive.yml` prevents that and is the most load-bearing
> workflow in the repo for a free deployment — do not disable it.

### The `DEPLOYMENT_ACTIVE` switch

Four workflows — nightly analytics, ops (digest + health check), the EDGAR
reconcile, and the Supabase keep-alive — talk to a **production database**.
Until one exists they have nothing to do, and a scheduled job that fails
nightly for "the deployment does not exist yet" is worse than no job at all:
it fills the Actions tab with red, sends failure email nobody reads, and
trains you to ignore the run that eventually means something.

So they are gated on a repository **variable** (not a secret):

```bash
# Turn them on, once the database and secrets are real:
gh variable set DEPLOYMENT_ACTIVE --body true

# Or: Settings → Secrets and variables → Actions → Variables → New variable
#     Name: DEPLOYMENT_ACTIVE     Value: true

# Turn them back off (e.g. while the project is paused):
gh variable delete DEPLOYMENT_ACTIVE
```

**Unset is the safe default.** Those jobs report as _skipped_ — grey, not red —
and nothing else in CI changes. A variable rather than a secret because
`secrets.*` cannot be read in a job-level `if:` (GitHub fails the whole
workflow with `Unrecognized named-value: 'secrets'`), while `vars.*` can.

Each gated job ALSO checks that `DATABASE_URL` is actually non-empty before
doing any work, so setting the variable before adding the secrets logs a
notice and exits 0 rather than failing. The two layers answer different
questions: the variable is "should this run at all", the guard is "is it
actually configured".

When each free tier stops being enough, what it costs, and what to do instead:
**[SCALING.md](SCALING.md)**.

## Documentation

| Doc                                           | What it covers                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| [quickstart.md](docs/quickstart.md)           | Run locally in one command; deploy free, step by step                    |
| [architecture.md](docs/architecture.md)       | How the pieces fit, and the invariants that hold it together             |
| [adapters.md](docs/adapters.md)               | **How to add a market** — one adapter, no schema change                  |
| [api.md](docs/api.md)                         | API conventions, caching, and the null/range rules clients must handle   |
| [alerts.md](docs/alerts.md)                   | Telegram bot setup, delivery contract, idempotency                       |
| [auth.md](docs/auth.md)                       | Supabase Auth, RLS, and the dev/prod story                               |
| [politicians.md](docs/politicians.md)         | STOCK Act data model and source provenance                               |
| [design-language.md](docs/design-language.md) | **Ledger** — tokens, type, motion, and the data-colour rules             |
| [AGENT_SAFETY.md](docs/AGENT_SAFETY.md)       | Tool metadata as untrusted data, edit provenance, and the MCP audit      |
| [performance.md](docs/performance.md)         | What Lighthouse actually measures here, and the one route that regressed |
| [SCALING.md](SCALING.md)                      | Free-tier limits, upgrade triggers, monthly costs                        |
| `/docs/methodology`                           | Every derived-analytics formula, published in full                       |
| `/design`                                     | The design system, rendered — every primitive with live data             |
| `/legal`                                      | Data sources, licences, and the disclaimers that apply                   |
| `/status`                                     | Live ingestion lag and per-source freshness                              |

## Before you make this repository public

Four settings that cost nothing, take about five minutes, and are worth more
than any check in this repo — because they act on the push, not after it.
Nothing below weakens or replaces an existing gate; they close the gap
between "CI caught it" and "it never got in".

**1. Secret scanning and push protection** (free on public repositories)

_Settings → Code security → Secret protection → enable **Secret scanning** and
**Push protection**._

`gitleaks` in CI tells you a credential is already in the history — by which
point the fix is rotation, not deletion. Push protection refuses the push,
which is the only outcome that leaves nothing to rotate. Enable both; they
cover different vendors than our own rules do.

**2. Branch protection on `main`**

_Settings → Branches → Add rule → `main`._ Require a pull request, and require
these status checks to pass:

| Check                           | Workflow           |
| ------------------------------- | ------------------ |
| `Typecheck, lint, test, build`  | `ci.yml`           |
| `No secrets in the built image` | `ci.yml`           |
| `osv-scanner`                   | `supply-chain.yml` |
| `pnpm audit`                    | `supply-chain.yml` |
| `gitleaks`                      | `supply-chain.yml` |

The `ci` job is where the seven gates live — typecheck, lint, format,
`lint:changelog`, `lint:e2e-locators`, `lint:e2e-assertions`,
`lint:api-schemas`. Requiring the job requires all seven.

Also tick **Do not allow bypassing the above settings**, or the protection
applies to everyone except the person most likely to be pushing at midnight.

Do NOT add the deployment workflows (analytics, ops, backfill, keepalive) as
required checks. They are gated on `DEPLOYMENT_ACTIVE` and report as skipped;
a required check that never runs blocks every merge.

**3. Dependabot**

_Settings → Code security → enable **Dependabot alerts** and **security
updates**._ `osv-scanner` and `pnpm audit` run daily and tell you an advisory
exists; Dependabot opens the pull request that fixes it. Add
`.github/dependabot.yml` for version updates too if the PR volume is welcome —
the daily scanners already cover the security half.

**4. Actions permissions**

_Settings → Actions → General → Workflow permissions → **Read repository
contents**._ Every workflow here declares what it needs; the repository
default should not be write.

## Legal / data-source notice

- **SEC EDGAR (US)** — EDGAR filings are US-government works in the **public domain** and free
  to redistribute. Access must follow the
  [SEC fair-access policy](https://www.sec.gov/os/accessing-edgar-data): a descriptive
  `User-Agent` (see `EDGAR_USER_AGENT` in `.env.example`) and no more than 10 requests/second.
- **NSE / BSE (India)** — Indian exchange insider-disclosure data is published on exchange
  websites **under restrictive terms of use; bulk scraping and redistribution are generally not
  permitted without a license.** The hosted InsiderFlow deployment does **not** scrape or
  redistribute that data. India support has two operator-choice paths: a licensed/user-supplied
  feed (`INDIA_FEED_URL`), or an **optional, off-by-default local scrape runner**
  ([ingestion/india-local](ingestion/india-local/README.md)) for operators who hold a license or
  knowingly accept the ToS risk on their own infrastructure. It requires an explicit
  `ENABLE_INDIA_INGEST=true`; the hosted instance ships without it. If you deploy your own
  instance, complying with the exchanges' terms is your responsibility.
- Data is provided **as is**, with no warranty of accuracy, completeness, or timeliness.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Good first areas: Form 4 XML parsing, alert routing,
watchlist UI.

## License

[AGPL-3.0](LICENSE). If you run a modified InsiderFlow as a network service, the AGPL requires
you to offer your users the modified source.
