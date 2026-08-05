# Congressional trading — source choice and data model

> ## ⚠️ Status as of 2026-08-04: the default source is DOWN
>
> Both stock-watcher datasets return **HTTP 403 AccessDenied** — the S3 buckets'
> public-read policy has been removed — and both project websites no longer
> resolve:
>
> ```
> 403  house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json
> 403  senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json
> 000  housestockwatcher.com   (no DNS)
> 000  senatestockwatcher.com  (no DNS)
> ```
>
> These were community-maintained volunteer projects, and they appear to have
> been retired.
>
> **Consequence:** a fresh deployment ingests **zero** congressional
> disclosures. `/politicians` says so explicitly rather than rendering an empty
> table that looks like a bug — see [Honest coverage](#honest-coverage).
>
> **The ingestion code is unaffected and tested**; it needs a live source. See
> [Swapping the source](#swapping-the-source).
>
> No replacement is bundled, because there is no free, machine-readable,
> licence-compatible one to bundle. Inventing or estimating disclosures would be
> worse than an empty page.

## Why not the official portals directly

The authoritative disclosures are:

- **House** — <https://disclosures-clerk.house.gov/PublicDisclosure/FinancialDisclosure>
- **Senate** — <https://efdsearch.senate.gov/search/>

Both are public and both are, in principle, the right source. Neither is usable
as a feed:

- PTRs are published as **scanned PDFs**, not structured data. Extracting the
  amount bracket and the ticker means OCR on a photocopy — for financial figures
  we would then be publishing as fact.
- The Senate EFD search is behind an **interstitial agreement form** that sets a
  session cookie before any query works, and it is explicitly designed for
  interactive use.
- Neither exposes a bulk export, a JSON API, or a change feed. Polling either at
  the volume needed for a live feed would be abusive, and rate-limiting it down
  to politeness makes it useless for the purpose.

Building an OCR pipeline that we could stand behind is not a free-tier project,
and one we could not stand behind is worse than none.

## What we use instead

**house-stock-watcher** and **senate-stock-watcher** — open datasets that
transcribe those same public filings into plain JSON:

- `https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json`
- `https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json`

Why these:

- **Public-domain source material.** They transcribe US government disclosures,
  which carry no copyright. The projects publish the transcriptions openly with
  no redistribution restriction — compatible with AGPL-3.0.
- **Provenance on every row.** Each record carries `ptr_link`, the URL of the
  original filed PDF. We store it in `politician_trades.source_url` and surface
  it on every row in the UI and in the RSS feed, so any figure can be checked
  against the filing it came from.
- **No key, no quota, no ToS gate.** Plain S3 objects.

### Why not a commercial API

Quiver, Capitol Trades, Unusual Whales and similar vendors offer cleaner data,
but their terms of service forbid redistribution of the underlying dataset.
InsiderFlow is AGPL and self-hostable: anyone who deploys it redistributes
whatever it serves. A source we cannot legally pass on is a source we cannot
use, regardless of quality.

<a id="swapping-the-source"></a>

### Swapping the source

Both URLs are configurable, so an operator can point the job at any source they
have the rights to use without touching the parser.

```bash
# Cloudflare Worker / GitHub Actions / .env
HOUSE_PTR_URL='https://your-source.example/house.json'
SENATE_PTR_URL='https://your-source.example/senate.json'
```

Or programmatically:

```ts
await ingestPoliticianTrades({ db, houseUrl, senateUrl, log });
```

**What the parser expects.** An array of objects. Field names from both
stock-watcher dialects are accepted, and unknown fields are ignored:

| Field            | Accepted keys                       | Notes                                                                                        |
| ---------------- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| filer            | `representative`, `senator`, `name` | honorifics stripped                                                                          |
| transaction date | `transaction_date`                  | `MM/DD/YYYY` or `YYYY-MM-DD`                                                                 |
| disclosure date  | `disclosure_date`                   | same formats                                                                                 |
| type             | `type`, `transaction_type`          | `purchase`, `sale`, `sale_partial`, `sale_full`, `exchange`, and the `Sale (Full)` spellings |
| amount           | `amount`                            | the bracket **as filed**, e.g. `"$1,001 - $15,000"`                                          |
| ticker           | `ticker`                            | `--`, `N/A`, and prose are treated as "no ticker"                                            |
| asset            | `asset_description`                 |                                                                                              |
| link             | `ptr_link`                          | stored as provenance and surfaced on every row                                               |

A row missing a filer, a transaction date, or a resolvable type is **dropped,
not defaulted**. Re-running over the same snapshot is a no-op.

**Verify before trusting it:**

```bash
DATABASE_URL=... HOUSE_PTR_URL=... pnpm --filter @insiderflow/analytics run nightly -- --only=politicians
```

then check `/politicians` — the coverage banner states the newest disclosure
date it actually holds.

### If you build your own pipeline

The gap is OCR over the official PDFs. If you fill it, the contract to hit is
the table above; everything downstream (dedup, ticker linkage, alerts, RSS,
the range-only rendering) already works. Two things to get right:

- **Never synthesise an amount.** Emit the bracket string as filed, or nulls.
- **Keep `ptr_link`.** Provenance on every row is what makes a disputed figure
  checkable against the filing.

A PR adding a working source would be welcome.

## STOCK Act mechanics that shape the schema

**Reporting deadline.** A transaction over $1,000 must be disclosed within **45
days**. So:

- `txn_date` and `disclosed_at` are separate columns, and the gap is real
  signal, not noise. A PTR filed today can describe a trade from six weeks ago.
- Feeds, alerts, and the freshness guard all key off **disclosure**, not the
  transaction date. A 40-day-old trade disclosed this morning is news this
  morning; ordering by `txn_date` would bury it.
- Filings past 45 days are flagged `late` in the API and labelled in the UI.
  This is a fact stated on the filing, not a judgement.

**Amounts are ranges.** Filers select a bracket:

| Bracket                   | min      | max      |
| ------------------------- | -------- | -------- |
| $1,001 – $15,000          | 1001     | 15000    |
| $15,001 – $50,000         | 15001    | 50000    |
| $50,001 – $100,000        | 50001    | 100000   |
| $100,001 – $250,000       | 100001   | 250000   |
| $250,001 – $500,000       | 250001   | 500000   |
| $500,001 – $1,000,000     | 500001   | 1000000  |
| $1,000,001 – $5,000,000   | 1000001  | 5000000  |
| $5,000,001 – $25,000,000  | 5000001  | 25000000 |
| $25,000,001 – $50,000,000 | 25000001 | 50000000 |
| Over $50,000,000          | 50000000 | **null** |

The schema models this as `amount_min` / `amount_max`, both nullable, plus the
verbatim `amount_range` label. **There is deliberately no `value` column.**

A midpoint would be a fabricated number: the filing genuinely does not contain
one, and a $1,000,001–$5,000,000 bracket collapsed to "$3M" is a figure no
document supports. Consumers filter on `amountMax` (`min_amount_usd`), which is
the only sense in which a bracket clears a threshold.

## Identity and dedup

- **Politicians** are keyed `"{chamber}:{normalized name}"`. Honorifics
  (`Hon.`, `Sen.`, `Rep.`) are stripped before normalization, so
  "Hon. Jane Doe" and "Jane Doe" are one person. Party/state/district are
  `coalesce`d on upsert — a later row can fill a field an earlier one lacked,
  but never blank one we already have.
- **Trades** are keyed
  `pol|{chamber}|{name}|{txn_date}|{ticker}|{txn_type}|{amount_range}#{n}`.
  The bracket is part of the key because a filer can disclose several trades of
  the same asset on the same day in different brackets; the `#n` suffix handles
  genuinely identical repeats. Re-ingesting the same snapshot is a no-op.

## Ticker linkage

`company_id` is resolved by exact US ticker match at ingest time and left null
otherwise — non-equity assets (bonds, funds, crypto) legitimately have no
company. `relinkPoliticianCompanies` re-runs the match nightly, because
companies arrive continuously from EDGAR and a PTR ingested before its issuer's
first Form 4 would otherwise stay unlinked forever.

<a id="honest-coverage"></a>

## Honest coverage

`/politicians` states what it actually holds, because an empty feed and a dead
pipeline look identical to a reader:

- **With data:** "Data through `<latest disclosure date>` · N disclosures from
  M filers", turning amber when the newest filing is more than 21 days old —
  the signature of an upstream that has stopped updating.
- **With none:** an explicit panel saying no disclosures are ingested, that the
  default source is unavailable, that the official portals publish only scanned
  PDFs, and that showing nothing is deliberate.

Served from `queryPoliticianCoverage`, and reported in `/api/health` as
`counts.politicianTrades`.

This is not decoration. The upstream has gone dark once already; a silent empty
table would have shipped as a bug report waiting to happen.

## Fixtures

Synthetic politician fixtures use **obviously fictional names** and the reserved
`ZZ*` ticker namespace, per the project-wide data-honesty rule. A fabricated
disclosure must never be attributable to a real person — a screenshot of one
attributed to a sitting member of Congress would be defamatory the moment it
left the developer's laptop.

The seed data ships four synthetic PTRs covering the cases that matter: a
purchase, a full sale, a filing 61 days late (past the STOCK Act deadline), and
an open-ended `Over $50,000,000` bracket whose `amount_max` is NULL and which
must render as `$50,000,000+`.

## Not investment advice

This is public disclosure data republished for research and education.
Congressional trades are not signals, endorsements, or recommendations, and
nothing here should be read as any of those.
