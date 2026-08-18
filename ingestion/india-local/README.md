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

| Dataset                    | Source                                         | Destination                                                                                                                                            |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PIT (SEBI insider trading) | NSE `corporates-pit-gg` index → XBRL documents | The normal `UnifiedTransaction` path — same contract as a licensed `INDIA_FEED_URL` feed (`country='IN'`, INR native + USD via FX, cross-source dedup) |
| SAST Reg. 29/31            | NSE `corporate-sast-reg29`                     | `sast_disclosures` table                                                                                                                               |
| Bulk + block deals         | NSE `historicalOR/bulk-block-short-deals`      | `bulk_block_deals` table                                                                                                                               |
| Promoter pledges           | NSE `corporate-pledgedata`                     | `pledge_disclosures` table                                                                                                                             |
| Cross-check                | BSE `AnnSubCategoryGetData` announcements      | Count of insider/SAST announcements logged against NSE coverage (metadata + PDF links only — BSE's API carries no structured trade numbers)            |

## Live-verification findings (2026-08-02)

- **NSE**: the homepage returns **403** to non-browser clients; the
  corporate-filings **listing page returns 200 and sets the session cookies** —
  that page is the priming target. Without browser-grade cookies the APIs
  answer 200 with empty `data` instead of erroring.
  > **Superseded in part.** This note went on to say "expect zero rows from
  > datacenter IPs", and that inference — empty means blocked — was wrong and
  > cost three rounds. An empty payload here is genuinely ambiguous: it can be a
  > session problem, a quiet week, **or an endpoint that no longer exists**. See
  > _PIT resolved_ below.
- **BSE**: `AnnSubCategoryGetData` works with plain `Origin`/`Referer`
  headers (no cookies). Empty date params mean "today". Responses are
  announcement metadata + PDF attachments; the scrip-search endpoint resolves
  symbols to scrip codes/ISINs.
- **NSE row field names** in `packages/core/src/adapters/india-scrape.ts` were
  inferred at this date and are now all RECORDED — SAST, bulk and pledges on
  2026-08-18, PIT on 2026-08-19. **Run the smoke first anyway** and compare
  `firstRowKeys` against the raw-row types: PIT has moved once already.

## Live-verification findings (2026-08-18) — residential Indian line

Run from a residential connection in Asia/Calcutta, which is the network
this runner is designed for. `pnpm --filter @insiderflow/india-local smoke`
at `--days=7` and again at `--days=90`. Nothing was written.

| Endpoint               | 7 days |  90 days | Field names                     |
| ---------------------- | -----: | -------: | ------------------------------- |
| NSE PIT (retired path) |  **0** |    **0** | endpoint RETIRED — see below    |
| NSE SAST               |    188 |    1,334 | **confirmed** — 25 keys         |
| NSE bulk deals         |     70 |       70 | **confirmed** — 9 keys          |
| NSE promoter pledges   |  1,693 |    1,693 | **confirmed** — 21 keys         |
| BSE announcements      | failed | 50 (2nd) | **confirmed** — 12 keys sampled |

Three things this changes.

**PIT is not a datacenter problem** — and r16 found what it actually is.
See the section below; the short version is that `corporates-pit` is
**retired** and answers an empty envelope to everyone. The suspicion
recorded here at the time — session fingerprint, or the `Referer` NSE
wants — was wrong too. Both are listed as ruled out below.

**Two endpoints ignore the date window.** Bulk deals returned exactly 70
rows and pledges exactly 1,693 for both a 7-day and a 90-day request. A
window parameter that changes nothing means `--days` cannot bound those
two, so the ingest's idempotency — not its query — is what stops repeated
work. That is fine today because dedup keys are enforced in the schema;
it is worth knowing before anyone reads a `--days=1` run as cheap.

**BSE announcements fail intermittently.** The first attempt died with
`Parse Error: Unexpected whitespace after header value` — Node's strict
HTTP parser refusing a malformed response header, not a network fault and
not a block. The second attempt, forty seconds later, returned 50 rows.
One failure in two attempts is a source that will page somebody at 3am.
If it recurs, `insecureHTTPParser` on the guarded request for the two
allowlisted BSE hosts is the narrow fix; it is deliberately not applied
pre-emptively, because relaxing a parser to work around a server that is
usually fine trades a real protection for a rare convenience.

Use `--days=N` on the smoke to tell a block apart from a quiet week:

```bash
ENABLE_INDIA_INGEST=true pnpm --filter @insiderflow/india-local smoke --days=90
```

## PIT resolved (2026-08-19) — the endpoint was retired, not blocked

`corporates-pit` is **retired**. It answers `HTTP 200` with
`{"acqNameList":[],"data":[]}` to every caller, from any address, with any
session. It was left returning a well-formed empty envelope instead of a
404, which is why three rounds of investigation looked at the network
instead of the endpoint.

The live path was found in NSE's own page source. The insider-trading page
declares what it calls, in an inline script:

```html
<script>
  activeLeftNav = "InsiderTrading";
  innerActiveTab = "equities";
  activeApiName = "corporates-pit-gg";
</script>
```

**`corporates-pit-gg` returns 169 filings over seven days and 353 over
thirty.** Measured back to back against the retired path in one session,
one second apart:

```
{"event":"smoke_nse","endpoint":"pit",        "rows":169,"firstRowKeys":["appId","broadcastDateTime",...]}
{"event":"smoke_nse","endpoint":"pit-retired","rows":0,  "firstRowKeys":[]}
```

The smoke now probes both, permanently. The retired endpoint is the
control: it is what "an empty answer that is not about you" looks like.

### The shape changed too: index, then document

PIT moved to XBRL — the documents carry `<!--PIT V2.0 (30-04-2026)-->`. A
row of `corporates-pit-gg` is a **submission**, not a trade, and carries no
numbers at all:

| Field                    | Example                                                 |
| ------------------------ | ------------------------------------------------------- |
| `symbol` / `companyName` | `JAYSREETEA` / `JAY SHREE TEA & INDUSTRIES LTD`         |
| `regulation`             | `Regulation 7 (2)` \| `Regulation 7 (3)`                |
| `typeOfSubmission`       | `Original` \| `Revision`                                |
| `appId` / `prevAppId`    | `2337` / `null` — a revision chains to what it replaces |
| `xmlFileName`            | the XBRL instance, on `nsearchives.nseindia.com`        |
| `ixbrl`                  | the same filing as inline-XBRL HTML, for humans         |

The trades are in the XBRL, under SEBI's `in-bse-co` taxonomy (BSE's
schema, which NSE also uses):
`CategoryOfPerson`, `NameOfThePerson`,
`SecuritiesHeldPriorToAcquisitionOrDisposalNumberOfSecurity`,
`SecuritiesAcquiredOrDisposedNumberOfSecurity` / `ValueOfSecurity` /
`TransactionType`, `SecuritiesHeldPostAcquistionOrDisposalNumberOfSecurity`
(NSE's misspelling, reproduced exactly), `ModeOfAcquisitionOrDisposal`,
`DateOfIntimationToCompany`, `ExchangeOnWhichTheTradeWasExecuted`.

This is the same two-step EDGAR uses — index, then parse — so
`persistUnified` and the whole UnifiedTransaction path are unchanged. **One
document can carry several transactions**: the filing recorded as a test
fixture has two, the same person on the same day, one on each exchange.

**The PIT field names are now CONFIRMED**, recorded from a live filing in
`packages/core/src/fixtures/india-samples.ts` and asserted in
`packages/core/src/adapters/pit-xbrl.test.ts`.

### Hypotheses tested and ruled out

Recorded because a negative result that nobody writes down gets re-tested.

| Hypothesis                                       | Result                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| Datacenter IP blocking                           | **Ruled out.** Residential Indian line, same empty response       |
| Too narrow a date window                         | **Ruled out.** 7 and 90 days both returned zero                   |
| Wrong `index` value                              | **Ruled out.** `equities` is what the page sets, and SAST uses it |
| Wrong `Referer`                                  | **Ruled out.** Same referer serves SAST and pledges 1,000+ rows   |
| Cookie priming failed                            | **Ruled out.** Same session returned 188 SAST rows seconds later  |
| Our parser reading the wrong key                 | **Ruled out.** Raw body is `{"acqNameList":[],"data":[]}` — empty |
| Endpoint needs a symbol rather than a date range | Not needed — the replacement takes the same date range            |
| **Endpoint retired and replaced**                | **CONFIRMED** — `corporates-pit-gg`, named by NSE's own page      |

### One thing still undecided, and left as filed

The XBRL reports a holding of 1,105,770 shares as `0.0383`, which reads as
a fraction where SAST's equivalent fields are whole percents. Resolving it
needs a shares-outstanding figure the document does not carry, so the filed
value is stored unchanged and the field is named `pctBeforeAsFiled` /
`pctAfterAsFiled` to say so. **Do not multiply it by a hundred on a hunch**
— that would put a wrong number in front of a reader with no way to tell.

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
_from this machine_. NSE returns 200 with empty `data` rather than an error
whenever it has nothing to give you, so a run that "succeeds" with zero rows
tells you nothing on its own.

Read the endpoints **against each other**, which is what the smoke is for:

- `pit` zero while `sast` and `pledge` return rows → the PIT index has moved
  again. Check `activeApiName` in the page source.
- `pit-retired` zero → expected, always. It is the control.
- Everything zero → the session or the network. That is the case the
  residential-IP advice is about, and it is the only one it covers.

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
