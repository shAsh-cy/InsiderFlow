# india-local — optional NSE/BSE local scrape runner

**OFF BY DEFAULT. The hosted InsiderFlow reference deployment does not run this
module, and nothing else in the repo imports it.** It exists for operators who
either hold a license for NSE/BSE data or knowingly accept the terms-of-service
risk of scraping it from their own machine.

## Legal posture — read before enabling

- NSE and BSE publish insider-trading disclosures on their websites under
  **restrictive terms of use** that generally prohibit automated access and
  redistribution. Scraping them may breach those terms and, in India,
  provisions of the Information Technology Act have been argued to apply to
  unauthorized automated access. Penalties and IP blocks are real possibilities.
- **The clean alternative**: license a data feed (or export data you are
  entitled to) and point the ingestion worker at it via `INDIA_FEED_URL`. That
  path involves no scraping and is the one the main README documents.
- This module never runs unless you set `ENABLE_INDIA_INGEST=true`. Without
  it, `pnpm india:ingest` prints the risk summary and exits non-zero.
- If you enable it: you are the operator; compliance is your responsibility.
  Do not point the hosted deployment at it, and do not redistribute the data.

## What it does

| Dataset                    | Source                                    | Destination                                                                                                                                            |
| -------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PIT (SEBI insider trading) | NSE `corporates-pit` (structured JSON)    | The normal `UnifiedTransaction` path — same contract as a licensed `INDIA_FEED_URL` feed (`country='IN'`, INR native + USD via FX, cross-source dedup) |
| SAST Reg. 29/31            | NSE `corporate-sast-reg29`                | `sast_disclosures` table                                                                                                                               |
| Bulk + block deals         | NSE `historicalOR/bulk-block-short-deals` | `bulk_block_deals` table                                                                                                                               |
| Promoter pledges           | NSE `corporate-pledgedata`                | `pledge_disclosures` table                                                                                                                             |
| Cross-check                | BSE `AnnSubCategoryGetData` announcements | Count of insider/SAST announcements logged against NSE coverage (metadata + PDF links only — BSE's API carries no structured trade numbers)            |

## Live-verification findings (2026-08-02)

- **NSE**: the homepage returns **403** to non-browser clients; the
  corporate-filings **listing page returns 200 and sets the session cookies** —
  that page is the priming target. Without browser-grade cookies the APIs
  **soft-fail with 200 + empty `data`** instead of erroring; expect zero rows
  from datacenter IPs. Undici/Node fetch speaks HTTP/1.1 — NSE currently
  accepts that with realistic headers, but if you see persistent empty
  responses on a residential line, that fingerprint is the next suspect.
- **BSE**: `AnnSubCategoryGetData` works with plain `Origin`/`Referer`
  headers (no cookies). Empty date params mean "today". Responses are
  announcement metadata + PDF attachments; the scrip-search endpoint resolves
  symbols to scrip codes/ISINs.
- **NSE row field names** in `packages/core/src/adapters/india-scrape.ts`
  follow the public API shapes but could not be re-recorded from this
  environment. **Run the smoke first** and compare `firstRowKeys` against the
  raw-row types before trusting a real run.

## Setup

```bash
# from the repo root; runs on a residential machine / home server, Node 20+
cp .env.example .env      # or export the vars below

ENABLE_INDIA_INGEST=true \
DATABASE_URL=postgres://... \        # your Supabase pooler URL or local Postgres
pnpm india:ingest -- --days=7
```

Manual live smoke (no database writes; prints row counts + field names):

```bash
ENABLE_INDIA_INGEST=true pnpm --filter @insiderflow/india-local smoke
```

Schedule it however you like (cron, systemd timer, Task Scheduler); a few runs
per day is plenty — these disclosures are not high-frequency.

## Rate limits and etiquette

- One shared limiter caps **all NSE traffic (priming included) at ≤3 req/s**
  (350 ms spacing); BSE calls are spaced ≥500 ms.
- On 401/403 the session re-primes cookies **once** and retries; persistent
  failures abort the run rather than hammering the exchange.
- A full default run is ~6 NSE requests + 1–2 BSE requests. Do not run it in
  a tight loop; FX rates are cached in Postgres so re-runs stay cheap.

## Not the Cloudflare Worker

Exchanges block datacenter IP ranges, and the worker's runtime has no place
for a cookie-priming browser impersonation. This module is a plain Node
process by design; the worker continues to serve EDGAR (and the licensed
`INDIA_FEED_URL` path) unchanged.

## Feeding a production database from a residential machine

**The hosted reference deployment does not run this.** It ships without India
scraping, and redistributes no NSE/BSE data. What follows is for a self-hoster
who has read the legal section above and decided to accept that risk for their
own deployment.

The setup is deliberately unglamorous: the runner lives on a machine you
control, on a residential connection, and writes to your production database
over the network. Nothing about the hosted stack changes.

```
┌────────────────────────┐        ┌──────────────────────┐
│ your home machine      │        │ Supabase (prod)      │
│  india-local runner    │───────▶│  transactions        │
│  residential IP        │  TLS   │  sast_disclosures    │
│  cron / systemd timer  │        │  bulk_block_deals    │
└────────────────────────┘        └──────────────────────┘
        ▲                                    ▲
        │ scrapes                            │ reads
   NSE / BSE                          Vercel + Worker
                                      (never touch NSE)
```

### 1. Smoke-test first, always

Before pointing anything at production, confirm the exchanges actually answer
_from this machine_. NSE soft-fails to empty data from datacenter IPs rather
than returning an error, so a run that "succeeds" with zero rows is the
signature of a blocked network, not a quiet day.

```bash
ENABLE_INDIA_INGEST=true pnpm --filter @insiderflow/india-local smoke
```

This writes **nothing**. It prints row counts and the field names it found:

```json
{"event":"smoke_nse","rows":37,"keys":["symbol","company","acqName","..."]}
{"event":"smoke_bse","rows":12,"keys":["scripcode","SrNo","..."]}
{"event":"smoke_done","nse":37,"bse":12}
```

**Zero rows means stop.** Either the IP is blocked or the feed shape changed —
either way, do not proceed to a database write. Non-zero counts with recognisable
field names mean the runner is working.

### 2. Point it at production

Use the **transaction pooler** URI (port 6543), same as everything else.

```bash
export ENABLE_INDIA_INGEST=true
export DATABASE_URL='postgres://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres'

# Start small and inspect before scheduling anything.
pnpm india:ingest -- --days=1
```

Then check what landed:

```sql
select source, country, count(*), max(created_at)
from transactions where country = 'IN' group by 1, 2;
```

### 3. Schedule it

Twice a day is plenty — these disclosures are not high-frequency, and a tight
loop is exactly the behaviour the legal section warns about.

```cron
# crontab -e   — 09:30 and 18:30 IST, after each session's filings settle
30 9,18 * * *  cd /home/you/insiderflow && ENABLE_INDIA_INGEST=true DATABASE_URL='postgres://...' pnpm india:ingest -- --days=2 >> /var/log/insiderflow-india.log 2>&1
```

`--days=2` overlaps deliberately: the dedup key makes re-ingesting a row a
no-op, so a missed run self-heals on the next one.

### 4. Operational notes

- **Keep the credential off the command line** where you can — a `DATABASE_URL`
  in a crontab is visible in `ps` output and in shell history. Prefer an env
  file with `chmod 600`, or systemd's `EnvironmentFile=`.
- **This machine now holds a production database credential.** Treat it
  accordingly; if the machine is shared or ever compromised, rotate the
  Supabase password.
- **Rows are attributed to `source = 'nse-bse'`**, so `/status` shows their
  freshness separately from EDGAR and you can see at a glance when the home
  runner has stopped.
- **It cannot corrupt EDGAR data.** Different source, different dedup keys,
  and the same upsert path everything else uses.

## The licensed-feed alternative

If you would rather not scrape at all — and for anything commercial you should
not — the same normalizer accepts a licensed feed:

```bash
INDIA_FEED_URL='https://your-licensed-provider.example/insider-disclosures'
```

Set it as a Cloudflare Worker secret and the hosted pipeline ingests India data
on the normal 1-minute cron, with no residential machine, no scraping, and no
`ENABLE_INDIA_INGEST`. The adapter expects JSON; see `IndiaAdapter.normalize` in
`packages/core/src/adapters/india.ts` for the shape, and
[docs/adapters.md](../../docs/adapters.md) if your provider's format differs.

This is the recommended path for any deployment that is not a personal project.
