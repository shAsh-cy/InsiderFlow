import { describe, expect, it } from "vitest";

import { assignDedupKeys, transactionIdentity } from "./dedup";
import { buildTransaction } from "./unified";
import type { UnifiedTransaction } from "./unified";

function edgarStyle(
  overrides: Partial<Parameters<typeof buildTransaction>[0]> = {},
): UnifiedTransaction {
  return buildTransaction({
    source: "edgar",
    market: "US",
    country: "US",
    currency: "USD",
    company: {
      externalKey: "cik:0000320193",
      cik: "0000320193",
      name: "Apple Inc.",
      ticker: "AAPL",
      country: "US",
    },
    insider: {
      externalKey: "cik:0001214156",
      name: "DOE JANE A",
      isDirector: true,
      isOfficer: true,
      isTenPercentOwner: false,
      title: "CFO",
    },
    filing: {
      accessionNo: "0000320193-26-000123",
      formType: "4",
      filedAt: "2026-07-31T21:05:12.000Z",
      sourceUrl: null,
      rawXmlUrl: null,
      originalFiledDate: null,
    },
    txnDate: "2026-07-30",
    code: "S",
    rawCode: "S",
    shares: 10_000,
    price: 228.4501,
    acquiredDisposed: "D",
    sharesOwnedAfter: 150_000,
    is10b51: true,
    isDerivative: false,
    footnote: null,
    ...overrides,
  });
}

function finnhubStyle(): UnifiedTransaction {
  // Same real-world trade as edgarStyle(), as Finnhub would report it:
  // no CIKs, no filing, ticker-keyed company, sign-derived A/D.
  return buildTransaction({
    source: "finnhub",
    market: "US",
    country: "US",
    currency: "USD",
    company: {
      externalKey: "ticker:US:AAPL",
      cik: null,
      name: "AAPL",
      ticker: "AAPL",
      country: "US",
    },
    insider: {
      externalKey: "name:US:DOE JANE A",
      name: "DOE JANE A",
      isDirector: false,
      isOfficer: false,
      isTenPercentOwner: false,
      title: null,
    },
    filing: null,
    txnDate: "2026-07-30",
    code: "S",
    rawCode: "S",
    shares: 10_000,
    price: 228.45, // sources round differently — price is NOT part of identity
    acquiredDisposed: "D",
    sharesOwnedAfter: 150_000,
    is10b51: false,
    isDerivative: false,
    footnote: null,
  });
}

describe("transactionIdentity", () => {
  it("gives the same trade the same identity across sources", () => {
    expect(transactionIdentity(edgarStyle())).toBe(transactionIdentity(finnhubStyle()));
    expect(transactionIdentity(edgarStyle())).toBe("US|AAPL|DOE JANE A|2026-07-30|10000|S");
  });

  it("distinguishes genuinely different trades", () => {
    expect(transactionIdentity(edgarStyle({ txnDate: "2026-07-29" }))).not.toBe(
      transactionIdentity(edgarStyle()),
    );
    expect(transactionIdentity(edgarStyle({ shares: 9999 }))).not.toBe(
      transactionIdentity(edgarStyle()),
    );
    expect(transactionIdentity(edgarStyle({ code: "P", rawCode: "P" }))).not.toBe(
      transactionIdentity(edgarStyle()),
    );
  });
});

describe("assignDedupKeys", () => {
  it("keeps legitimate intra-batch repeats but collides across batches", () => {
    // Two identical lots in one filing are both kept (#0, #1)...
    const batch1 = [edgarStyle(), edgarStyle()];
    const keys1 = assignDedupKeys(batch1);
    expect(new Set(keys1).size).toBe(2);
    expect(keys1[0]).toMatch(/#0$/);
    expect(keys1[1]).toMatch(/#1$/);

    // ...while the same trade arriving later from Finnhub reproduces "#0"
    // and gets rejected by the unique index.
    const keys2 = assignDedupKeys([finnhubStyle()]);
    expect(keys2[0]).toBe(keys1[0]);
  });
});
