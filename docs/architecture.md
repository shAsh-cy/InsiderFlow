# Architecture

## The shape of it

```mermaid
flowchart TB
    subgraph sources["Data sources"]
        EDGAR["SEC EDGAR<br/>Forms 3/4/5 · public domain"]
        PTR["STOCK Act PTRs<br/>congressional disclosures"]
        PRICES["Stooq closes · ECB FX<br/>keyless, cached forever"]
        OPT["Finnhub · FMP<br/>optional, key-gated"]
        NSE["NSE / BSE<br/>off by default · licence-restricted"]
    end

    subgraph ingest["Ingestion"]
        WORKER["Cloudflare Worker<br/><b>cron: every minute</b><br/>ingest → clusters → alert scan → dispatch"]
        DIGEST["Cloudflare Worker<br/><b>cron: hourly</b><br/>digest flush"]
        NIGHTLY["GitHub Actions<br/><b>nightly</b><br/>SIC · PTR · prices · scoring · anomalies"]
        LOCAL["india-local runner<br/>manual, residential IP"]
    end

    subgraph data["Postgres — Supabase free tier"]
        CORE[("companies · insiders<br/>filings · transactions")]
        DERIVED[("cluster_flags · trade_returns<br/>insider_scores · company_anomalies")]
        USER[("watchlists · alert_rules<br/>alert_channels · alerts_log<br/><i>RLS enabled</i>")]
        STATE[("ingestion_state · scanner_state<br/><i>cursors + leases</i>")]
    end

    subgraph app["Vercel"]
        WEB["Next.js 15 · RSC<br/>pages + public API + SSE"]
    end

    subgraph out["Delivery"]
        TG["Telegram<br/>free, unlimited, instant"]
        MAIL["Resend<br/>100/day → batched digest"]
        RSS["RSS · JSON API"]
    end

    EDGAR --> WORKER
    OPT --> WORKER
    PRICES --> WORKER
    PRICES --> NIGHTLY
    PTR --> NIGHTLY
    NSE -.-> LOCAL

    WORKER --> CORE
    WORKER --> DERIVED
    WORKER --> STATE
    NIGHTLY --> DERIVED
    LOCAL --> CORE

    CORE --> WEB
    DERIVED --> WEB
    USER --> WEB
    STATE --> WEB

    WORKER --> TG
    DIGEST --> MAIL
    DIGEST --> TG
    WEB --> RSS
```

## Why the pieces sit where they do

**Ingestion is a Cloudflare Worker, not a GitHub Action.** Actions' shortest
schedule is 5 minutes and it queues under load, so a 60-second filing-to-feed
target is unreachable. Cloudflare gives 5 free cron triggers at one-minute
granularity. We use 2.

**Nightly analytics is a GitHub Action, not a Worker.** None of it has a
60-second deadline, several steps pull tens of megabytes or make hundreds of
rate-limited requests, and Workers have a CPU budget per invocation. Being on
Actions also keeps the worker's remaining 3 cron triggers free.

**The web app never calls its own API.** Server components query the shared
Drizzle layer directly. An HTTP self-call inside a serverless function pays a
second cold start and a second network hop for data the process could have
fetched itself, and it turns one failure domain into two.

**The alert scanner is cursor-driven over `transactions`, not triggered by
ingestion.** Rows arrive from the worker, the Actions backfill, and the optional
India runner. A scanner that only ran when _it_ wrote something would miss the
other two.

## Discovery and processing are separate, and that is the point

EDGAR's "current events" feed is a **rolling window of the 100 most recent
filings**. The original design polled one page and ingested up to
`MAX_FILINGS_PER_RUN` (25) of what it found; anything beyond that was neither
processed nor remembered. Under sustained arrival above 25/min the unprocessed
remainder grew, and once it exceeded 100 the oldest unprocessed filings scrolled
out of the window and were **never seen again** — there was no cursor to go back
for them. At 50 filings/min that takes about four minutes, and Form 4 volume
clusters heavily after the US close, so it was a plausible daily condition
rather than a pathological one.

So the two halves are split:

**Discovery** pages the feed backwards (`&start=`) until a page contains nothing
new — meaning it has overlapped what is already held — and writes every new ref
to `pending_filings`. It fetches no filing documents and is cheap enough that it
is never the thing the per-run cap skips.

**Processing** drains `pending_filings` **oldest-first** at the per-run cap.
Oldest-first is a durability property, not a preference: a newest-first drain
under sustained load starves the tail forever, which is the same data loss in
slower motion.

Losing a filing now requires losing a database row. A burst becomes a queue with
a visible depth — `/api/health` reports the depth and the age of the oldest
waiting filing, and `/status` shows both — instead of a log line and a gap.

Two backstops:

- Queued filings that fail `PENDING_FILING_MAX_ATTEMPTS` times stop being
  retried but are **kept**, with `last_error`, so one permanently-404 filing
  cannot block the queue behind it and cannot silently disappear either.
- A nightly reconcile job (`backfill --reconcile`) compares EDGAR's
  authoritative daily full-index against what we hold and **reports** every
  accession number the live path missed before queueing it. Reporting comes
  first on purpose: a job that silently repairs gaps hides the defect that
  produced them.

## Data flow, one filing at a time

1. The worker pages EDGAR's Atom feed and queues every unseen accession in
   `pending_filings`; the drain then takes the oldest ones, up to the cap.
2. Each queued accession is fetched, the `ownershipDocument` XML parsed, and
   rows normalized: SEC code taxonomy, role flags, native currency + USD via
   cached FX, and a `routine` / `opportunistic` label. The queue row is deleted
   on success.
3. Rows upsert on `dedup_key` — `US|AAPL|DOE JANE|2026-07-30|10000|S#0` — so
   the same trade arriving later from Finnhub is a no-op.
4. Cluster flags are recomputed for the companies touched in that run.
5. The alert scanner takes a lease, reads rows past its cursor, matches them
   against enabled rules, and writes `alerts_log` with
   `ON CONFLICT (rule_id, dedup_key) DO NOTHING`.
6. Instant matches dispatch to Telegram; digest matches wait for the hourly
   flush.
7. The cursor advances **after** dispatch — at-least-once, with the unique
   index absorbing the duplicate work.

## The invariants

These are the things the code is arranged to protect. Breaking one is a bug
even if every test passes.

**A missing value is never a zero.** If a filing does not disclose a price, a
share count, or a value, the derived figure is null and the UI says so.
`min_value_usd` cannot match a row with no value.

**Nothing is synthesised to fill a gap.** STOCK Act amounts are ranges, so
`amountMin`/`amountMax` are stored separately and there is deliberately no
`value` column. A scoring horizon with no price data yields null, not an
interpolation.

**One filter builder.** `buildTradeConditions` in `packages/db` is used by the
screener, `/api/trades`, _and_ the alert scanner. A saved screen that alerted
differently from how it screened was a real bug once; the parity tests exist so
it cannot recur.

**Idempotency is structural, not procedural.** `transactions.dedup_key` and
`alerts_log (rule_id, dedup_key)` are unique indexes. Correctness does not
depend on any job running exactly once.

**Synthetic data is quarantined.** Fixtures use the reserved `ZZ*` ticker
namespace and are excluded from every aggregate surface — leaderboards,
heatmaps, anomaly rankings. A fabricated trade can never be presented as market
data.

**Concurrency is leased, not assumed.** The alert scanner and the digest each
take a compare-and-set lease in `scanner_state`. Leases rather than advisory
locks, because transaction-mode pooling does not guarantee session state
between statements.

## The CTE trap

Data-modifying CTEs in a single statement share one snapshot and cannot see
each other's rows. This silently broke an amendment fixture once: a `WITH`
chain that inserted a filing and then tried to update rows to point at it
updated nothing, with no error.

Cursor claim, cursor advance, `alerts_log` writes, and cluster-flag
upsert/retract are therefore **separate statements on purpose**. There are
warning comments at each site. Do not "optimize" them into one chain.

## Package layout

| Package                  | Depends on       | Holds                                                                                                   |
| ------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------- |
| `packages/core`          | nothing          | Pure logic: SEC codes, Form 4 parsing, dedup keys, SIC→sector, PTR parsing, FX/price URLs. No database. |
| `packages/db`            | core             | Drizzle schema, pooler-safe client, **shared trade filters**                                            |
| `packages/alerts`        | core, db         | Scanner, matcher, leases, Telegram/Resend dispatch                                                      |
| `packages/analytics`     | core, db, alerts | Clusters, scoring, anomalies, sector + PTR ingestion, ops status                                        |
| `apps/web`               | core, db, alerts | Next.js app, public API, SSE                                                                            |
| `ingestion/edgar-worker` | all              | Cloudflare Worker + backfill + docker loop                                                              |
| `ingestion/india-local`  | core, db         | Optional, off-by-default NSE/BSE runner                                                                 |

`core` has no database dependency, which is what lets its logic be tested
without one and reused in the Worker runtime.

## Testing

Integration tests run on **PGlite** — Postgres compiled to WASM, in-process,
no container. Every test gets a real Postgres with the real schema pushed into
it, and never touches a development database.

One caveat worth knowing: PGlite is more forgiving than real Postgres about
untyped parameter binding. A raw `sql` template that sent a JS `Date` passed
every PGlite test and failed against Docker Postgres. Where a test exercises
type coercion, verify against a real server too.

E2E is Playwright against a production build, with fixtures in the `ZZ*`
namespace cleaned up afterwards.
