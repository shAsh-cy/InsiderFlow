# How to add a market

Adding a market means writing **one adapter**. No schema change, no new table,
no change to the screener, the API, the alert engine, or the UI — those all
operate on the normalized shape your adapter produces.

This guide walks the whole path with a real example.

## The contract

```ts
export interface SourceAdapter {
  id: SourceId; // "edgar" | "nse-bse" | "finnhub" | ...
  market: Market; // "US" | "IN" | "EU" | "CA" | ...
  metadata: MarketMetadata; // currency, latency class, legal note
  fetch(ctx: AdapterContext): Promise<unknown[]>;
  normalize(raw: unknown[], ctx: AdapterContext): Promise<UnifiedTransaction[]>;
}
```

`fetch` pulls raw payloads. `normalize` maps them into `UnifiedTransaction`.
Persistence, deduplication, FX conversion, and entity resolution are handled
for you.

## The five things normalization must get right

### 1. Map to the SEC transaction-code taxonomy

Every market's codes collapse into the 20 SEC codes, because that is what the
screener, the relevance classifier, and the signal weights are defined over.

```ts
// India's PIT disclosures describe modes, not codes.
const CODE_BY_MODE: Record<string, SecTransactionCode> = {
  "market purchase": "P",
  "market sale": "S",
  "esop allotment": "A", // a grant, not a decision
  "off market": "J", // "other acquisition/disposition"
  gift: "G",
};
```

If a mode genuinely has no equivalent, use `J`/`K` (other) and keep the source
wording in `rawCode`. Do **not** invent a code, and do not force something into
`P` because it increases the row's apparent signal.

### 2. Classify relevance honestly

`opportunistic` means a discretionary decision. `routine` means compensation
plumbing — grants, vesting, tax withholding, 10b5-1 plan sales.

This is the single most load-bearing field in the product: it is what separates
"a CEO chose to buy" from "a payroll system moved shares". `classifyRelevance`
in `packages/core` handles the SEC codes; a new market usually needs no more
than mapping its modes correctly.

### 3. Preserve nulls

```ts
// WRONG — invents a fact the filing does not contain.
value: raw.value ?? 0,

// RIGHT — "not disclosed" is information.
value: raw.value === undefined ? null : Number(raw.value),
```

The NSE SAST feed, for instance, carries no monetary value at all. Those rows
are stored with `value: null` and render as "not disclosed", never `$0`.

### 4. Emit native currency; USD is derived

Set `currency` and `value` as filed. The pipeline converts to `valueUsd` using
the ECB rate **for the transaction date**, cached permanently in `fx_rates`
because historical rates never change. Never convert in the adapter.

### 5. Produce a stable dedup key

```ts
transactionIdentity({
  market,
  companyKey,
  insiderName,
  txnDate,
  shares,
  code,
}); // → "IN|RELIANCE|DOE JANE|2026-07-30|10000|S"
```

`assignOccurrenceKeys` appends `#0`, `#1`, … for genuinely repeated trades.
The key must be **derived from the trade**, not from the source's own row id —
that is what makes the same trade arriving from a second source a no-op rather
than a duplicate.

## Worked example

`packages/core/src/adapters/example.ts`:

```ts
import { assignOccurrenceKeys, buildTransaction, transactionIdentity } from "../unified";
import type { AdapterContext, SourceAdapter, UnifiedTransaction } from "../unified";

const CODE_BY_TYPE: Record<string, string> = {
  BUY: "P",
  SELL: "S",
  GRANT: "A",
};

export const exampleAdapter: SourceAdapter = {
  id: "example",
  market: "XX",
  metadata: {
    name: "Example Exchange",
    currency: "XXX",
    latency: "daily", // "realtime" | "intraday" | "daily"
    legalNote: "Public filings; verify redistribution terms before deploying.",
  },

  async fetch(ctx) {
    if (!ctx.env.EXAMPLE_FEED_URL) {
      // Never hard-fail an unconfigured optional source — return nothing.
      throw new AdapterNotConfiguredError("EXAMPLE_FEED_URL is not set");
    }
    const response = await ctx.fetchFn(ctx.env.EXAMPLE_FEED_URL);
    if (!response.ok) throw new Error(`feed returned ${response.status}`);
    return JSON.parse(await response.text()).disclosures ?? [];
  },

  async normalize(raw, ctx) {
    const out: UnifiedTransaction[] = [];
    for (const row of raw as Array<Record<string, unknown>>) {
      const code = CODE_BY_TYPE[String(row.type).toUpperCase()];
      if (!code) continue; // drop, do not guess

      const shares = row.quantity === null ? null : Number(row.quantity);
      const price = row.price === null ? null : Number(row.price);

      out.push(
        buildTransaction({
          source: "example",
          market: "XX",
          company: {
            externalKey: `ticker:XX:${row.symbol}`,
            ticker: String(row.symbol),
            name: String(row.company),
          },
          insider: {
            name: String(row.person),
            isOfficer: /officer|director/i.test(String(row.role)),
          },
          txnDate: String(row.date).slice(0, 10),
          code,
          rawCode: String(row.type),
          shares,
          price,
          // Null in, null out. Never `?? 0`.
          value: shares !== null && price !== null ? shares * price : null,
          currency: "XXX",
          identity: transactionIdentity({
            market: "XX",
            companyKey: String(row.symbol),
            insiderName: String(row.person),
            txnDate: String(row.date).slice(0, 10),
            shares,
            code,
          }),
        }),
      );
    }
    return assignOccurrenceKeys(out);
  },
};
```

Register it in `packages/core/src/adapters/index.ts`, and wire the fetch into
`ingestion/edgar-worker/src/sources.ts` behind its own env check and interval
gate.

## Testing it

Put a **real captured payload** in `packages/core/src/fixtures/` — not a
hand-written object. Hand-written fixtures encode what you assumed the feed
looks like, which is exactly the thing that turns out to be wrong.

```ts
it("normalizes a purchase, and never invents a value", async () => {
  const rows = await exampleAdapter.normalize(EXAMPLE_FIXTURE, ctx);

  expect(rows[0]).toMatchObject({ code: "P", relevance: "opportunistic", currency: "XXX" });
  // A row the feed reported with no price must stay null.
  expect(rows.find((r) => r.dedupKey.includes("NOPRICE"))?.value).toBeNull();
});

it("is idempotent across re-fetches", async () => {
  const first = await exampleAdapter.normalize(EXAMPLE_FIXTURE, ctx);
  const second = await exampleAdapter.normalize(EXAMPLE_FIXTURE, ctx);
  expect(first.map((r) => r.dedupKey)).toEqual(second.map((r) => r.dedupKey));
});
```

## Rate limits and politeness

Every adapter must be a good citizen of its source, and the constraint belongs
in the adapter, not in a comment:

- Use `createCachedFetch` so a response is never fetched twice.
- Use `RateLimiter` for a minimum interval between requests.
- Gate the whole run behind `claimRun` so a failing source cannot burn a daily
  API budget in a retry loop.

Reference points: SEC EDGAR requires a descriptive User-Agent with a contact
address and ≤10 req/s. Finnhub's free tier is 60/min. FMP's is ~250/day.

## Before you open the PR

Check the source's terms. **This is the part that decides whether an adapter can
be enabled by default, and it is not optional.**

- **Public domain** (SEC EDGAR, STOCK Act filings) → enable by default.
- **Restrictive terms** (NSE, BSE) → ship the normalizer, default it **off**,
  document the risk. See [politicians.md](politicians.md) and
  [../ingestion/india-local/README.md](../ingestion/india-local/README.md) for
  how this project has handled it twice.
- **Forbids redistribution** (most commercial APIs) → usable with an operator's
  own key, never in the hosted deployment. An AGPL project's users
  redistribute whatever it serves.

Add a `legalNote` to the adapter's metadata and a section to
`apps/web/src/app/legal/page.tsx` if it introduces new terms. A market that
cannot be documented cannot be shipped.

## Checklist

- [ ] Codes map to the SEC taxonomy; unmapped rows dropped, not guessed
- [ ] `relevance` distinguishes discretionary from routine
- [ ] Nulls preserved — no `?? 0` on a disclosed value
- [ ] Native currency emitted; no conversion in the adapter
- [ ] `dedup_key` derived from the trade, not the source row id
- [ ] Fixture is a real captured payload
- [ ] Idempotency test
- [ ] Rate limited and cached
- [ ] Legal note written; default-on vs default-off decided deliberately
