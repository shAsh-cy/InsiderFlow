# API reference

**The live, always-current reference is your own deployment:**

- **[`/docs`](/docs)** — rendered, browsable
- **[`/api/openapi.json`](/api/openapi.json)** — OpenAPI 3.0 spec

That spec is generated from the same Zod schemas the routes validate against,
so it cannot drift from the implementation. This page covers the things a spec
does not say well: the conventions, the caching contract, and the data-honesty
rules a client needs to handle correctly.

## Basics

Base URL is your deployment. No key required.

```bash
curl 'https://<your-app>/api/trades?relevance=opportunistic&min_value_usd=250000&limit=10'
```

**Rate limits.** 60 requests/min per IP; 600/min with an `x-api-key` header
(operator sets `API_KEYS`). Every response carries `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, and `X-RateLimit-Reset`. A 429 includes `Retry-After`.

**CORS** is open (`Access-Control-Allow-Origin: *`) — this is public data.

## Endpoints

| Endpoint                               | Returns                                           |
| -------------------------------------- | ------------------------------------------------- |
| `GET /api/trades`                      | Normalized transactions, filterable and paginated |
| `GET /api/companies/:ticker`           | Profile, 90-day aggregates, MSPR, price context   |
| `GET /api/companies/:ticker/sentiment` | MSPR time series                                  |
| `GET /api/insiders/:id`                | Insider profile + recent trades                   |
| `GET /api/screener/:preset`            | A canned screen; user filters compose with it     |
| `GET /api/heatmap`                     | Net flow by company / sector / country            |
| `GET /api/leaderboard`                 | Insider performance vs SPY                        |
| `GET /api/politicians`                 | STOCK Act disclosures                             |
| `GET /api/rss/:screen`                 | RSS 2.0 for any preset                            |
| `GET /api/rss/politicians`             | RSS 2.0 for congressional disclosures             |
| `GET /api/stream`                      | SSE live feed (`?mode=poll` for a JSON batch)     |
| `GET /api/health`                      | Service health, never cached                      |

Screener presets: `latest`, `big-buys`, `cluster-buys`, `exec-buys`,
`dip-buys`, `big-discretionary-sales`, `unusual-flow`.

## Conventions that matter

### Pagination

```json
{ "data": [...], "meta": { "limit": 50, "offset": 0, "count": 50,
                           "hasMore": true, "nextOffset": 50 } }
```

Follow `meta.nextOffset` until it is `null`. Do not compute offsets yourself.

### Caching

Responses carry `Cache-Control: public, s-maxage=<n>, stale-while-revalidate=<m>`
and a weak `ETag`. Send `If-None-Match` and handle `304`:

```bash
curl -H 'If-None-Match: W/"abc123"' 'https://<your-app>/api/trades?limit=10' -i
```

TTLs run from 60s (`/api/trades`) to 3600s (`/api/leaderboard`, `/api/politicians`),
matching how fast each dataset actually moves. `/api/health` is `no-store` — a
cached health check is a lie with a TTL.

### Amendments

Form 4/A amendments supersede their originals, and superseded rows are **hidden
by default**. Pass `include_superseded=true` to see them; `filing.superseded`
tells you which is which.

### The data-honesty rules

These are the ones that break naive clients.

**`null` never means zero.** If a filing did not disclose a price, a share
count, or a value, the field is `null`. Rendering `value: null` as `$0` states
something the filing does not.

```js
// WRONG
const total = trades.reduce((sum, t) => sum + t.valueUsd, 0); // NaN, or a lie

// RIGHT
const priced = trades.filter((t) => t.valueUsd !== null);
const total = priced.reduce((sum, t) => sum + t.valueUsd, 0);
// ...and say how many rows were excluded.
```

**Congressional amounts are ranges, not figures.** `/api/politicians` returns
`amountMin` and `amountMax`, either of which may be `null` (the top bracket is
open-ended). There is deliberately **no `value` field**, because a STOCK Act
filing does not contain one. Do not average the bounds — a midpoint is a number
no document supports.

```json
{ "amountMin": 1001, "amountMax": 15000, "amountRange": "$1,001 - $15,000" }
{ "amountMin": 50000000, "amountMax": null, "amountRange": "Over $50,000,000" }
```

Render the bracket. `min_amount_usd` filters on the **upper** bound, which is
the only sense in which a bracket clears a threshold.

**`relevance` is the signal filter.** `routine` is compensation plumbing —
grants, vesting, tax withholding. `opportunistic` is a discretionary decision.
Most consumers want `relevance=opportunistic`; without it, a feed is dominated
by payroll events.

**Analytics are descriptive, not predictive.** `/api/leaderboard` returns
backward-looking statistics computed by the formulas at
[`/docs/methodology`](/docs/methodology). Excess returns are measured against
SPY and signed by direction, so a well-timed sale scores as a win. The composite
score is shrunk toward zero by sample size. None of it is investment advice.

## Live stream

Server-Sent Events, designed around serverless constraints:

```js
const es = new EventSource("/api/stream");
es.addEventListener("trade", (e) => console.log(JSON.parse(e.data)));
```

The server closes each window after ~25 seconds; `EventSource` reconnects
automatically and `Last-Event-ID` resumes without loss. If you cannot hold a
connection, poll instead — one cached request rather than a held one:

```bash
curl 'https://<your-app>/api/stream?mode=poll&last_event_id=<cursor>'
```

## RSS

Every screener preset has a feed, and the congressional feed accepts the same
filters as its JSON endpoint:

```
/api/rss/big-buys
/api/rss/cluster-buys
/api/rss/politicians?chamber=senate
/api/rss/politicians?late_only=true
```

## Errors

```json
{
  "error": {
    "code": "bad_request",
    "message": "Invalid query parameters",
    "issues": [{ "path": "limit", "message": "..." }]
  }
}
```

`400` invalid parameters (with `issues`) · `404` unknown ticker/preset/id ·
`429` rate limited (`Retry-After`) · `500` server error.

## Attribution and terms

US data originates from SEC EDGAR and is in the public domain; congressional
disclosures are public records. Full terms, including the restrictions that
apply to Indian exchange data, are on the deployment's [`/legal`](/legal) page.

Nothing served by this API is investment advice.
