/**
 * Integration test: the real pipeline against an in-memory Postgres (PGlite)
 * with EDGAR mocked. Verifies normalized rows, idempotency (same feed twice
 * → no duplicates), and cross-source dedup (the same trade arriving from
 * Finnhub after EDGAR is dropped by the dedup_key unique index).
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";
import { describe, expect, it } from "vitest";

import { finnhubAdapter } from "@insiderflow/core";
import { SAMPLE_FORM4_XML, wrapAsSubmissionText } from "@insiderflow/core/fixtures";
import * as dbExports from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

import type { FetchLike, FetchLikeResponse } from "./http";
import { ingestFilingRefs, ingestFromFeed, persistUnified } from "./pipeline";

const SECOND_FORM4_XML = SAMPLE_FORM4_XML.replace("0001214156", "0009876543").replace(
  "Doe  Jane A.",
  "Smith Robert",
);

// Form 4/A amending filing -000123: the sale and RSU rows are re-reported
// unchanged, the purchase quantity is corrected 2500 → 2600.
const AMENDMENT_XML = SAMPLE_FORM4_XML.replace(
  "<documentType>4</documentType>",
  "<documentType>4/A</documentType>\n    <dateOfOriginalSubmission>2026-07-31</dateOfOriginalSubmission>",
).replace("<value>2500</value>", "<value>2600</value>");

// Holdings-only Form 3 (initial ownership statement): no transaction tables.
// Its filing must still be recorded, or it gets re-fetched every run.
const FORM3_XML = SAMPLE_FORM4_XML.replace(
  "<documentType>4</documentType>",
  "<documentType>3</documentType>",
)
  .replace("0001214156", "0005554443")
  .replace("Doe  Jane A.", "Newhire Casey")
  .replace(/<nonDerivativeTable>[\s\S]*?<\/nonDerivativeTable>/, "")
  .replace(/<derivativeTable>[\s\S]*?<\/derivativeTable>/, "");

const FEED_XML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Latest Filings - Form 4</title>
  <entry>
    <title>4 - DOE JANE A (0001214156) (Reporting)</title>
    <link rel="alternate" href="https://www.sec.gov/Archives/edgar/data/320193/000032019326000123/0000320193-26-000123-index.htm"/>
    <category label="form type" term="4"/>
    <id>urn:tag:sec.gov,2008:accession-number=0000320193-26-000123</id>
    <updated>2026-07-31T17:05:14-04:00</updated>
  </entry>
  <entry>
    <title>4 - SMITH ROBERT (0009876543) (Reporting)</title>
    <link rel="alternate" href="https://www.sec.gov/Archives/edgar/data/320193/000032019326000124/0000320193-26-000124-index.htm"/>
    <category label="form type" term="4"/>
    <id>urn:tag:sec.gov,2008:accession-number=0000320193-26-000124</id>
    <updated>2026-07-31T17:06:02-04:00</updated>
  </entry>
  <entry>
    <title>3 - NEWHIRE CASEY (0005554443) (Reporting)</title>
    <link rel="alternate" href="https://www.sec.gov/Archives/edgar/data/320193/000032019326000125/0000320193-26-000125-index.htm"/>
    <category label="form type" term="3"/>
    <id>urn:tag:sec.gov,2008:accession-number=0000320193-26-000125</id>
    <updated>2026-07-31T17:07:00-04:00</updated>
  </entry>
</feed>`;

function textResponse(body: string, status = 200): FetchLikeResponse {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  };
}

const requestLog: string[] = [];
const fetchMock: FetchLike = (url) => {
  requestLog.push(url);
  if (url.includes("action=getcurrent&type=4")) return Promise.resolve(textResponse(FEED_XML));
  if (url.includes("action=getcurrent")) return Promise.resolve(textResponse("<feed></feed>"));
  if (url.endsWith("/0000320193-26-000123.txt")) {
    return Promise.resolve(textResponse(wrapAsSubmissionText(SAMPLE_FORM4_XML, "20260731170512")));
  }
  if (url.endsWith("/0000320193-26-000124.txt")) {
    return Promise.resolve(textResponse(wrapAsSubmissionText(SECOND_FORM4_XML, "20260731170702")));
  }
  if (url.endsWith("/0000320193-26-000125.txt")) {
    return Promise.resolve(textResponse(wrapAsSubmissionText(FORM3_XML, "20260731170801")));
  }
  if (url.endsWith("/0000320193-26-000126.txt")) {
    return Promise.resolve(textResponse(wrapAsSubmissionText(AMENDMENT_XML, "20260801090001")));
  }
  return Promise.resolve(textResponse("not found", 404));
};

describe("ingestion pipeline (PGlite integration)", () => {
  it("ingests, normalizes, never duplicates on re-run, and dedupes across sources", async () => {
    const client = new PGlite({ extensions: { pg_trgm } });
    await client.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
    const pgliteDb = drizzle(client, { schema: dbExports });
    const { apply } = await pushSchema(
      { ...dbExports },
      pgliteDb as unknown as Parameters<typeof pushSchema>[1],
    );
    await apply();
    const db = pgliteDb as unknown as Database;

    const options = {
      db,
      userAgent: "InsiderFlow-test/0.1 (test@example.com)",
      fetchFn: fetchMock,
      requestDelayMs: 0,
      log: () => {},
    };

    const started = Date.now();
    const first = await ingestFromFeed(options);

    expect(first.discovered).toBe(3);
    expect(first.ingested).toBe(3); // includes the holdings-only Form 3
    expect(first.transactionsInserted).toBe(6);
    expect(first.transactionsDeduped).toBe(0);
    expect(first.skippedEmpty).toBe(0);
    expect(first.errors).toBe(0);

    const companyRows = await db.select().from(dbExports.companies);
    expect(companyRows).toHaveLength(1); // same issuer in both filings → one upserted row
    expect(companyRows[0]).toMatchObject({
      externalKey: "cik:0000320193",
      cik: "0000320193",
      ticker: "AAPL",
      country: "US",
    });

    const insiderRows = await db.select().from(dbExports.insiders);
    expect(insiderRows).toHaveLength(2); // the Form 3 records a filing but no insider row (no transactions)
    const jane = insiderRows.find((i) => i.cik === "0001214156")!;
    expect(jane).toMatchObject({
      externalKey: "cik:0001214156",
      name: "DOE JANE A",
      isDirector: true,
      isOfficer: true,
      isTenPctOwner: false,
      officerTitle: "Chief Financial Officer",
    });

    const filingRows = await db.select().from(dbExports.filings);
    expect(filingRows).toHaveLength(3);
    const form3 = filingRows.find((f) => f.accessionNo === "0000320193-26-000125")!;
    expect(form3.formType).toBe("3");
    const filing123 = filingRows.find((f) => f.accessionNo === "0000320193-26-000123")!;
    // Acceptance 2026-07-31 17:05:12 EDT → 21:05:12 UTC
    expect(filing123.filedAt.toISOString()).toBe("2026-07-31T21:05:12.000Z");

    const txnRows = await db.select().from(dbExports.transactions);
    expect(txnRows).toHaveLength(6);
    const sale = txnRows.find((t) => t.filingId === filing123.id && t.code === "S")!;
    expect(sale).toMatchObject({
      source: "edgar",
      txnDate: "2026-07-30",
      shares: "10000.0000",
      price: "228.4501",
      value: "2284501.0000",
      currency: "USD",
      priceUsd: "228.4501", // USD → identity FX
      valueUsd: "2284501.0000",
      acquiredDisposed: "D",
      is10b51: true,
      relevance: "routine", // 10b5-1 sale
      country: "US",
    });
    expect(sale.dedupKey).toBe("US|AAPL|DOE JANE A|2026-07-30|10000|S#0");
    const purchase = txnRows.find((t) => t.filingId === filing123.id && t.code === "P")!;
    expect(purchase.relevance).toBe("routine"); // filing-level 10b5-1 checkbox covers it

    // Second run over the same feed: everything already known — including
    // the holdings-only Form 3 — so zero new rows and zero re-fetches.
    const second = await ingestFromFeed(options);
    expect(second.alreadyKnown).toBe(3);
    expect(second.ingested).toBe(0);
    expect(second.transactionsInserted).toBe(0);
    expect(await db.select().from(dbExports.transactions)).toHaveLength(6);
    // The diff happens in the DB, so already-known filings are not re-fetched.
    expect(requestLog.filter((u) => u.endsWith(".txt"))).toHaveLength(3);

    // ── Cross-source dedup: the same sale arrives again via Finnhub ────────
    const finnhubTxns = finnhubAdapter.normalize({
      pages: [
        {
          symbol: "AAPL",
          data: [
            {
              // Jane's 2026-07-30 sale of 10,000 shares — already in the DB from EDGAR.
              name: "DOE JANE A",
              share: 150_000,
              change: -10_000,
              transactionDate: "2026-07-30",
              transactionCode: "S",
              transactionPrice: 228.45, // sources round differently; price is not part of identity
              symbol: "AAPL",
            },
            {
              // A trade EDGAR has not delivered — must be inserted.
              name: "DOE JANE A",
              share: 150_500,
              change: 500,
              transactionDate: "2026-07-28",
              transactionCode: "P",
              transactionPrice: 220,
              symbol: "AAPL",
            },
          ],
        },
      ],
    });
    expect(finnhubTxns).toHaveLength(2);

    const crossSource = await persistUnified(finnhubTxns, { db, log: () => {} });
    expect(crossSource.transactionsDeduped).toBe(1); // the EDGAR-known sale
    expect(crossSource.transactionsInserted).toBe(1); // the new purchase

    const afterCross = await db.select().from(dbExports.transactions);
    expect(afterCross).toHaveLength(7);
    const finnhubRow = afterCross.find((t) => t.source === "finnhub")!;
    expect(finnhubRow).toMatchObject({
      code: "P",
      shares: "500.0000",
      relevance: "opportunistic",
      filingId: null,
    });
    // Cross-source entity resolution: Finnhub's ticker/name mapped onto the
    // company and insider rows EDGAR created — no duplicate entities.
    expect(finnhubRow.companyId).toBe(companyRows[0]!.id);
    expect(finnhubRow.insiderId).toBe(jane.id);
    expect(await db.select().from(dbExports.companies)).toHaveLength(1);
    expect(await db.select().from(dbExports.insiders)).toHaveLength(2);

    // ── Form 4/A amendment: supersede the original, keep unchanged rows ────
    const amendStats = await ingestFilingRefs(
      [
        {
          accessionNo: "0000320193-26-000126",
          cik: "0000320193",
          formType: "4/A",
          filedAt: "2026-08-01T09:00:01-04:00",
          sourceUrl: null,
        },
      ],
      options,
    );
    // The corrected purchase (2600 shares) inserts; the unchanged sale and
    // RSU rows dedupe against the original filing's rows.
    expect(amendStats.ingested).toBe(1);
    expect(amendStats.transactionsInserted).toBe(1);
    expect(amendStats.transactionsDeduped).toBe(2);

    const filingsAfterAmend = await db.select().from(dbExports.filings);
    expect(filingsAfterAmend).toHaveLength(4);
    const amendment = filingsAfterAmend.find((f) => f.accessionNo === "0000320193-26-000126")!;
    expect(amendment.formType).toBe("4/A");
    expect(amendment.supersededByFilingId).toBeNull();
    const supersededOriginal = filingsAfterAmend.find(
      (f) => f.accessionNo === "0000320193-26-000123",
    )!;
    expect(supersededOriginal.supersededByFilingId).toBe(amendment.id);

    // Smith's same-day filing against the same issuer must NOT be superseded.
    const smithFiling = filingsAfterAmend.find((f) => f.accessionNo === "0000320193-26-000124")!;
    expect(smithFiling.supersededByFilingId).toBeNull();

    const txnsAfterAmend = await db.select().from(dbExports.transactions);
    expect(txnsAfterAmend).toHaveLength(8);
    // Unchanged rows were re-homed onto the amendment (still visible when
    // superseded filings are hidden)...
    const saleAfter = txnsAfterAmend.find((t) => t.code === "S" && t.insiderId === jane.id)!;
    expect(saleAfter.filingId).toBe(amendment.id);
    // ...while the corrected-away original purchase stays on the superseded filing.
    const stalePurchase = txnsAfterAmend.find((t) => t.code === "P" && t.shares === "2500.0000")!;
    expect(stalePurchase.filingId).toBe(supersededOriginal.id);
    const correctedPurchase = txnsAfterAmend.find(
      (t) => t.code === "P" && t.shares === "2600.0000",
    )!;
    expect(correctedPurchase.filingId).toBe(amendment.id);

    // Cursor recorded for observability.
    const cursorRows = await db.select().from(dbExports.ingestionState);
    expect(cursorRows.map((c) => c.key)).toContain("edgar:cursor");

    // Everything above ran far inside the 2-minute latency budget.
    expect(Date.now() - started).toBeLessThan(120_000);

    await client.close();
  }, 120_000);
});
