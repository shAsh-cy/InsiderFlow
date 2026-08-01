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

**Today**: SEC EDGAR Form 4 ingestion (US). **Planned**: more filing types (Forms 3/5, 13D/G),
more markets (see the legal notes below), watchlists, and email/Telegram alerts.

## Architecture

```mermaid
flowchart LR
    subgraph sources["Data sources"]
        EDGAR["SEC EDGAR<br/>Form 4 filings (public domain)"]
        NSE["NSE / BSE insider disclosures<br/>(planned — licensing constraints)"]
    end

    subgraph ingestion["Ingestion — Cloudflare Workers (free)"]
        WORKER["ingestion/edgar-worker<br/>cron every minute<br/>fetch → parse → upsert (packages/core)"]
    end

    subgraph data["Data — Supabase (free)"]
        PG[("Postgres<br/>packages/db (Drizzle ORM)")]
    end

    subgraph app["App — Vercel (free)"]
        WEB["apps/web<br/>Next.js 15 · RSC · Tailwind"]
    end

    subgraph alerts["Alerts (free tiers)"]
        RESEND["Resend email"]
        TG["Telegram bot"]
    end

    EDGAR -->|poll Atom feed| WORKER
    NSE -.->|planned| WORKER
    WORKER -->|upsert| PG
    PG -->|queries| WEB
    PG -->|new-filing triggers| RESEND
    PG --> TG
```

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
| `/api/screener/:preset`            | Canned screens: big-buys, cluster-buys, exec-buys, dip-buys, ...                                                               |
| `/api/heatmap`                     | Per-company USD buy/sell aggregates for treemaps                                                                               |
| `/api/politicians`                 | Placeholder (congressional trading ingestion planned)                                                                          |
| `/api/rss/:screen`                 | RSS 2.0 feed of any screen                                                                                                     |
| `/api/stream`                      | SSE live feed — ~25s serverless windows, Last-Event-ID resume, `?mode=poll` fallback                                           |

Form 4/A amendments supersede their originals and are hidden by default
(`include_superseded=true` to opt back in).

### Monorepo layout

```
insiderflow/
├── apps/
│   └── web/                 # Next.js 15 (App Router, RSC, Tailwind CSS)
├── packages/
│   ├── core/                # Shared types, normalization, SEC transaction-code enums
│   └── db/                  # Drizzle ORM schema + Postgres client
├── ingestion/
│   └── edgar-worker/        # Cloudflare Worker: EDGAR cron ingestion
└── .github/workflows/       # CI: typecheck, lint, test, build
```

## Getting started

```bash
pnpm install
docker compose up -d   # local Postgres (or use a Supabase project)
pnpm db:migrate        # apply migrations (includes the pg_trgm extension)
pnpm dev               # web app on http://localhost:3000

# run the ingestion worker locally (1-min cron; use --test-scheduled trigger)
pnpm --filter @insiderflow/edgar-worker dev

# backfill the last 30 days of Form 4 filings from the EDGAR full-index
pnpm backfill -- --days=30 --forms=4
```

Copy `.env.example` → `.env` and `ingestion/edgar-worker/.dev.vars.example` → `.dev.vars` and
fill in your values. Quality gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Free-tier deployment

The entire stack runs on free tiers — **no paid services required**:

| Piece           | Service            | Free tier that matters                         |
| --------------- | ------------------ | ---------------------------------------------- |
| Web app         | Vercel Hobby       | Next.js hosting, RSC, edge network             |
| Database        | Supabase Free      | 500 MB Postgres + REST API + connection pooler |
| Ingestion       | Cloudflare Workers | 100k requests/day + cron triggers              |
| Email alerts    | Resend             | 100 emails/day                                 |
| Telegram alerts | Telegram Bot API   | Free, unlimited for this scale                 |

Deploy: point Vercel at `apps/web`, create a Supabase project and set `DATABASE_URL`
(transaction-pooler URL), then `pnpm --filter @insiderflow/edgar-worker deploy` with secrets set
via `wrangler secret put`.

## Legal / data-source notice

- **SEC EDGAR (US)** — EDGAR filings are US-government works in the **public domain** and free
  to redistribute. Access must follow the
  [SEC fair-access policy](https://www.sec.gov/os/accessing-edgar-data): a descriptive
  `User-Agent` (see `EDGAR_USER_AGENT` in `.env.example`) and no more than 10 requests/second.
- **NSE / BSE (India)** — Indian exchange insider-disclosure data is published on exchange
  websites **under restrictive terms of use; bulk scraping and redistribution are generally not
  permitted without a license.** InsiderFlow therefore does **not** ship NSE/BSE ingestion or
  redistribute that data. The multi-market schema is ready, but India support is gated on
  properly licensed or user-supplied data. If you deploy your own instance, complying with the
  exchanges' terms is your responsibility.
- Data is provided **as is**, with no warranty of accuracy, completeness, or timeliness.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Good first areas: Form 4 XML parsing, alert routing,
watchlist UI.

## License

[AGPL-3.0](LICENSE). If you run a modified InsiderFlow as a network service, the AGPL requires
you to offer your users the modified source.
