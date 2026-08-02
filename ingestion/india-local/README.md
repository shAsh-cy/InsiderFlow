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
