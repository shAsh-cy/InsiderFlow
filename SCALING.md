# Scaling

InsiderFlow runs on **$0/month** at low volume, and that is the design point,
not an accident. This document says exactly when each free tier stops being
enough, what it costs to fix, and what to do instead if you would rather not
pay.

Every number is the published limit at the time of writing. Verify before
relying on one — providers change tiers.

## The short version

| You hit                            | You pay               | Per month    |
| ---------------------------------- | --------------------- | ------------ |
| Supabase 500 MB / project pausing  | Supabase Pro          | **$25**      |
| ...or move the database            | Neon Launch           | **$5+**      |
| Vercel 100 GB bandwidth            | Vercel Pro            | **$20**      |
| Workers 100k req/day or 10 ms CPU  | Workers Paid          | **$5**       |
| Resend 100 emails/day              | Resend Pro            | **$20**      |
| Rate-limit state outgrows memory   | Upstash pay-as-you-go | **~$0–10**   |
| Worker CPU limits on analytics     | Hetzner CX22          | **~€4.50**   |
| SSE connections outgrow serverless | Ably free → paid      | **$0 → $29** |

A realistic first upgrade is **Supabase Pro at $25/month**, and the trigger is
usually project pausing rather than storage.

---

## Database

### The free tier

Supabase free: **500 MB** database, 1 GB file storage, 2 GB egress, and — the
one that actually bites — **projects pause after 7 consecutive idle days**.

A paused project returns HTTP 540 and stays down until someone clicks Restore.
`.github/workflows/keepalive.yml` pings twice a week to prevent this. It is the
single most load-bearing workflow in the repo for a free deployment.

### How fast does the data actually grow?

Measure, do not guess:

```sql
select pg_size_pretty(pg_database_size(current_database())) as total;

select relname,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total,
       n_live_tup as rows
from pg_class c join pg_stat_user_tables s on s.relid = c.oid
where c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc limit 10;
```

The arithmetic that drives it:

```
EDGAR Form 4 filings           ≈ 500–900 per business day
transactions per filing        ≈ 1.5–2.5   (multi-line filings are common)
→ transactions                 ≈ 1,000–2,000 rows/day
                               ≈ 250,000–500,000 rows/year

bytes per transaction row       ≈ 400 B data + ~250 B across 8 indexes
→ transactions table            ≈ 450 MB/year at the high end
filings                         ≈ 200k rows/year × ~300 B ≈ 60 MB/year
daily_prices                    ≈ 250 rows/symbol/year — 5,000 symbols ≈ 1.2M rows ≈ 120 MB
trade_returns                   ≈ 1 row per scored trade ≈ 15% of transactions
```

**Roughly 500–700 MB per year of full-market US coverage**, dominated by
`transactions` and its indexes. So:

- **Watchlist-only or a few hundred companies** → free tier lasts years.
- **Full US market** → you cross 500 MB in **8–12 months**.
- Add EU/Canada aggregators and it is faster.

### What to do about it

**First, reclaim space before paying for more.**

```sql
-- Dead tuples from upserts are not returned to the OS by autovacuum alone.
VACUUM (ANALYZE, VERBOSE) transactions;

-- api_cache is disposable by construction.
DELETE FROM api_cache WHERE expires_at < now();

-- daily_prices beyond the longest scoring horizon (180d) + a margin.
DELETE FROM daily_prices WHERE price_date < current_date - 400;
```

That routinely recovers 20–30%.

**Then decide between two paths:**

|                  | Supabase Pro            | Neon Launch                                       |
| ---------------- | ----------------------- | ------------------------------------------------- |
| Cost             | $25/mo                  | $5/mo + usage                                     |
| Storage          | 8 GB included           | 10 GB included                                    |
| Pausing          | none                    | scale-to-zero (a feature, with cold starts)       |
| Auth             | included, already wired | you keep Supabase free _just_ for auth            |
| Migration effort | none                    | change `DATABASE_URL`, re-run `pnpm db:bootstrap` |

Supabase Pro is the low-effort answer. Neon is genuinely cheaper if you are
willing to split auth from data — and the code already supports that, because
auth holds sessions only and every app table lives behind `DATABASE_URL`.

### Partitioning — and when it is premature

Do not partition at 1M rows. Postgres is fine there, and partitioning adds
operational weight for nothing.

**The real trigger is ~50M rows in `transactions`**, or when
`explain (analyze, buffers)` on the trades feed shows index scans reading far
more buffers than rows returned.

Before partitioning, add the composite indexes the hot paths actually want:

```sql
-- Feed: newest first, filtered by relevance.
CREATE INDEX CONCURRENTLY transactions_created_relevance_idx
  ON transactions (created_at DESC, relevance);

-- Company page: one company, newest first.
CREATE INDEX CONCURRENTLY transactions_company_date_idx
  ON transactions (company_id, txn_date DESC);

-- Big-buys style screens. The partial index keeps it small, because
-- opportunistic P/S rows are a minority of the table.
CREATE INDEX CONCURRENTLY transactions_screen_idx
  ON transactions (code, value_usd DESC)
  WHERE relevance = 'opportunistic';
```

If you do partition, range-partition on `txn_date` by quarter, keep the current
and previous partition hot, and detach older ones to cold storage. Every query
in the app filters or sorts by date, so partition pruning is effective.

---

## Web app

### The free tier

Vercel Hobby: **100 GB bandwidth/month**, 100 GB-hours of function execution,
10-second function timeout, and — the term that matters — **non-commercial use
only**. Putting ads on it or charging for it requires Pro regardless of traffic.

### When you cross it

100 GB is a lot for this app: pages are server-rendered HTML with no heavy
assets, and the API is small JSON. Realistically:

- **~50k–150k page views/month** before bandwidth is a concern.
- **SSE is the exception.** Each `/api/stream` connection holds a function
  invocation for ~25 seconds. 100 concurrent listeners ≈ 4 invocations/second
  sustained, which burns GB-hours fast.

**Reduce it before paying:**

- Point RSS and bot traffic at the cached JSON endpoints; they already carry
  `s-maxage`.
- Raise `s-maxage` in `CACHE_POLICIES` (`apps/web/src/lib/api/http.ts`) — the
  data moves on a one-minute cron, so a 60-second TTL on `/api/trades` is
  conservative.
- Tell polling clients to use `/api/stream?mode=poll`, which is a single cached
  request rather than a held connection.

**Then:** Vercel Pro, **$20/month**, 1 TB bandwidth. Or self-host the Next.js
app on the same VPS as the analytics (below) — the `Dockerfile` in this repo
builds a production image, so that path is already open.

### SSE at scale

Serverless SSE is a compromise: the ~25-second window plus `Last-Event-ID`
resume exists precisely because functions cannot be held open indefinitely.

**Move to managed pub/sub when you exceed roughly 200 concurrent stream
connections**, or when stream invocations dominate your function usage.

[Ably](https://ably.com) free tier covers 200 concurrent connections and 6M
messages/month; their paid tier starts at **$29/month**. Supabase Realtime is
also already available on the project you have — it broadcasts Postgres changes
over WebSocket, and the client-side `useTradeStream` hook was written so its
transport can be swapped without touching the components.

---

## Ingestion

### The free tier

Cloudflare Workers free: **100,000 requests/day**, **10 ms CPU per
invocation**, 5 cron triggers.

A one-minute cron is 1,440 invocations/day — nowhere near the request cap. **CPU
time is the binding constraint**, not requests. Each tick parses XML, runs the
alert scanner, and maintains cluster flags.

### When it bites

- **Backfills.** Never run one on the worker; that is why `pnpm backfill` is a
  GitHub Action.
- **Many alert rules.** The scanner evaluates every enabled rule against each
  batch. Somewhere in the **low thousands of rules**, a tick starts flirting
  with the CPU limit.
- **Wide market coverage.** More adapters per tick means more parsing.

Watch for `Error: Worker exceeded CPU time limit` in `wrangler tail`.

**Workers Paid is $5/month** and raises CPU to 30 s/invocation (configurable to
5 min) with 10M requests included. This is the cheapest upgrade on the list and
usually the right one.

### Or move ingestion to a VPS

At the point where CPU limits genuinely bite, a small box is cheaper and
simpler than tuning around them:

**Hetzner CX22 — 2 vCPU, 4 GB RAM, 40 GB disk, ~€4.51/month.**

```bash
git clone https://github.com/insiderflow/insiderflow.git && cd insiderflow
cp .env.example .env          # set DATABASE_URL + EDGAR_USER_AGENT
docker compose --profile live up -d ingest
```

`ingestion/edgar-worker/scripts/loop.ts` runs the identical pipeline on a plain
interval — same code, no Cloudflare runtime. The same box comfortably runs the
nightly analytics and the Next.js app too, which collapses three bills into one.

**A VPS is not free-tier.** It is listed because at scale it is _cheaper_ than
the sum of the paid tiers it replaces, not because it is a lateral move.

---

## Alerts

### The free tier

- **Telegram: free and unlimited.** This is why it is the primary channel.
- **Resend free: 100 emails/day, 3,000/month.** The binding constraint on the
  whole alerting system.

The architecture already assumes this: email batches into **one digest per user
per day** regardless of how many alerts it covers, and a Telegram-only rule
defaults to instant because there is nothing to conserve.

### When you cross it

100 emails/day ≈ **100 users with email digests enabled**. Telegram users cost
nothing, so encourage Telegram in your onboarding.

Past that: **Resend Pro, $20/month**, 50,000 emails/month. Alternatives at
similar volume are Postmark ($15/mo) and AWS SES (~$0.10 per 1,000, cheapest by
far but requires you to manage reputation and warm the domain).

Telegram has no realistic ceiling here — the bot API's ~30 messages/second
limit is far beyond anything this generates.

---

## Rate limiting

The public API is limited in-memory per instance by default. That is fine for a
single region and honest about its own limitation: serverless instances do not
share state, so the effective limit is `configured × instances`.

**Move to Upstash Redis when** you need a real global limit — abuse, a public
launch, or paid API tiers. Set `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` and the limiter switches automatically.

Upstash free: 10,000 commands/day. Each rate-limit check is ~2 commands, so
**~5,000 API requests/day** before the free tier runs out. Pay-as-you-go is
$0.20 per 100k commands — a busy month is single-digit dollars.

---

## A worked upgrade path

Where a real deployment ends up, in order:

| Stage           | Reality                                                    | Monthly                           |
| --------------- | ---------------------------------------------------------- | --------------------------------- |
| **Launch**      | Watchlist coverage, <1k visitors, a handful of alert users | **$0**                            |
| **~6 months**   | Full US market, DB nearing 500 MB                          | **$25** (Supabase Pro)            |
| **Traction**    | 100+ email digest users                                    | **$45** (+ Resend Pro)            |
| **Busy**        | Worker CPU limits during market hours                      | **$50** (+ Workers Paid)          |
| **Scale**       | 200+ concurrent SSE, >100 GB bandwidth                     | **$99** (+ Vercel Pro, Ably)      |
| **Alternative** | Self-host ingestion + analytics + web on one CX22          | **~$30** (Supabase Pro + Hetzner) |

The last row is the interesting one: once you are paying for anything,
consolidating onto a VPS is usually cheaper than the sum of the managed tiers,
at the cost of running it yourself.

## What to watch

`/status` and `/api/health` report ingestion lag, per-source freshness, and
alert-pipeline state. `ops.yml` pings a Telegram chat every 6 hours when a job
falls behind.

The specific signals that mean "time to upgrade":

| Signal                        | Where              | Means                                  |
| ----------------------------- | ------------------ | -------------------------------------- |
| DB size > 400 MB              | `pg_database_size` | Supabase Pro within ~2 months          |
| HTTP 540                      | anywhere           | Project paused — check `keepalive.yml` |
| `exceeded CPU time limit`     | `wrangler tail`    | Workers Paid, or move to a VPS         |
| Resend 429                    | worker logs        | Past 100 emails/day                    |
| Rising `ingestRunAgeSeconds`  | `/api/health`      | Cron is failing or being throttled     |
| Stream invocations dominating | Vercel usage       | Move SSE to managed pub/sub            |
