/**
 * Integration test: runs the real pipeline against an in-memory Postgres
 * (PGlite) with EDGAR mocked, and verifies normalized rows + idempotency —
 * ingesting the same feed twice must not create duplicates.
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";
import { describe, expect, it } from "vitest";

import { SAMPLE_FORM4_XML, wrapAsSubmissionText } from "@insiderflow/core/fixtures";
import * as dbExports from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

import type { FetchLike, FetchLikeResponse } from "./http";
import { ingestFromFeed } from "./pipeline";

const SECOND_FORM4_XML = SAMPLE_FORM4_XML.replace("0001214156", "0009876543").replace(
  "Doe  Jane A.",
  "Smith Robert",
);

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
  return Promise.resolve(textResponse("not found", 404));
};

describe("ingestion pipeline (PGlite integration)", () => {
  it("ingests new filings, normalizes rows, and never duplicates on re-run", async () => {
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

    expect(first.discovered).toBe(2);
    expect(first.ingested).toBe(2);
    expect(first.transactionsInserted).toBe(6);
    expect(first.errors).toBe(0);

    const companyRows = await db.select().from(dbExports.companies);
    expect(companyRows).toHaveLength(1); // same issuer in both filings → one upserted row
    expect(companyRows[0]).toMatchObject({ cik: "0000320193", ticker: "AAPL", country: "US" });

    const insiderRows = await db.select().from(dbExports.insiders);
    expect(insiderRows).toHaveLength(2);
    const jane = insiderRows.find((i) => i.cik === "0001214156")!;
    expect(jane).toMatchObject({
      name: "DOE JANE A",
      isDirector: true,
      isOfficer: true,
      isTenPctOwner: false,
      officerTitle: "Chief Financial Officer",
    });

    const filingRows = await db.select().from(dbExports.filings);
    expect(filingRows).toHaveLength(2);
    const filing123 = filingRows.find((f) => f.accessionNo === "0000320193-26-000123")!;
    expect(filing123.formType).toBe("4");
    // Acceptance 2026-07-31 17:05:12 EDT → 21:05:12 UTC
    expect(filing123.filedAt.toISOString()).toBe("2026-07-31T21:05:12.000Z");
    expect(filing123.rawXmlUrl).toContain("0000320193-26-000123.txt");

    const txnRows = await db.select().from(dbExports.transactions);
    expect(txnRows).toHaveLength(6);
    const sale = txnRows.find((t) => t.filingId === filing123.id && t.code === "S")!;
    expect(sale).toMatchObject({
      txnDate: "2026-07-30",
      shares: "10000.0000",
      price: "228.4501",
      value: "2284501.0000",
      acquiredDisposed: "D",
      sharesOwnedAfter: "150000.0000",
      is10b51: true,
      isDerivative: false,
      country: "US",
    });
    expect(sale.insiderId).toBe(jane.id);
    const derivative = txnRows.filter((t) => t.isDerivative);
    expect(derivative).toHaveLength(2);
    expect(derivative[0]!.code).toBe("M");

    // Second run over the same feed: everything already known, zero new rows.
    const second = await ingestFromFeed(options);
    expect(second.discovered).toBe(2);
    expect(second.alreadyKnown).toBe(2);
    expect(second.ingested).toBe(0);
    expect(second.transactionsInserted).toBe(0);
    expect(await db.select().from(dbExports.filings)).toHaveLength(2);
    expect(await db.select().from(dbExports.transactions)).toHaveLength(6);
    // The diff happens in the DB, so already-known filings are not re-fetched.
    expect(requestLog.filter((u) => u.endsWith(".txt"))).toHaveLength(2);

    // Cursor recorded for observability.
    const [cursor] = await db.select().from(dbExports.ingestionState);
    expect(cursor?.key).toBe("edgar:cursor");
    expect(cursor?.value).toMatchObject({ ingested: 0, alreadyKnown: 2 });

    // Both full runs completed far inside the 2-minute latency budget.
    expect(Date.now() - started).toBeLessThan(120_000);

    await client.close();
  }, 120_000);
});
