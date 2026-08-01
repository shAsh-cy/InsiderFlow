import { describe, expect, it } from "vitest";

import { SAMPLE_FORM4_XML, wrapAsSubmissionText } from "../fixtures/form4-sample";
import { AdapterNotConfiguredError } from "../unified";
import type { UnifiedTransaction } from "../unified";
import { normalizeEdgarSubmission } from "./edgar";
import { finnhubAdapter } from "./finnhub";
import type { FinnhubRawBatch } from "./finnhub";
import { fmpAdapter } from "./fmp";
import type { FmpRawBatch } from "./fmp";
import { indiaAdapter, mapIndiaMode, parseIndianDate } from "./india";
import type { IndiaRawBatch } from "./india";
import { SOURCE_ADAPTERS } from "./index";
import { euMarAdapter, sediAdapter } from "./stubs";

function assertUnifiedShape(txn: UnifiedTransaction): void {
  expect(txn.company.externalKey.length).toBeGreaterThan(0);
  expect(txn.insider.externalKey.length).toBeGreaterThan(0);
  expect(txn.txnDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(txn.code).toMatch(/^[A-Z]$/);
  expect(["routine", "opportunistic"]).toContain(txn.relevance);
  expect(txn.currency.length).toBe(3);
}

describe("adapter registry", () => {
  it("exposes metadata for every source", () => {
    for (const adapter of Object.values(SOURCE_ADAPTERS)) {
      expect(adapter.metadata.market.length).toBeGreaterThan(0);
      expect(adapter.metadata.country.length).toBeGreaterThan(0);
      expect(adapter.metadata.currency.length).toBe(3);
      expect(adapter.metadata.regulator.length).toBeGreaterThan(0);
      expect(adapter.metadata.disclosureDeadline.length).toBeGreaterThan(0);
      expect(["realtime", "intraday", "daily", "delayed"]).toContain(adapter.metadata.latencyClass);
    }
  });
});

describe("EdgarAdapter", () => {
  const ref = {
    accessionNo: "0000320193-26-000123",
    cik: "0000320193",
    formType: "4",
    filedAt: "2026-07-31T17:05:14-04:00",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/x-index.htm",
  };
  const txns = normalizeEdgarSubmission(ref, wrapAsSubmissionText(SAMPLE_FORM4_XML));

  it("maps a Form 4 submission to UnifiedTransactions", () => {
    expect(txns).toHaveLength(3);
    for (const txn of txns) assertUnifiedShape(txn);
    expect(txns[0]).toMatchObject({
      source: "edgar",
      market: "US",
      currency: "USD",
      code: "S",
      shares: 10_000,
      price: 228.4501,
      value: 2_284_501,
      acquiredDisposed: "D",
      is10b51: true,
      relevance: "routine", // 10b5-1 sale → routine
    });
    expect(txns[0]!.company).toMatchObject({
      externalKey: "cik:0000320193",
      ticker: "AAPL",
      cik: "0000320193",
    });
    expect(txns[0]!.insider).toMatchObject({ externalKey: "cik:0001214156", name: "DOE JANE A" });
    expect(txns[0]!.filing).toMatchObject({ accessionNo: "0000320193-26-000123", formType: "4" });
  });

  it("classifies the open-market purchase as opportunistic once the 10b5-1 checkbox is off", () => {
    const noPlan = wrapAsSubmissionText(
      SAMPLE_FORM4_XML.replace("<aff10b5One>1</aff10b5One>", "<aff10b5One>0</aff10b5One>"),
    );
    const parsed = normalizeEdgarSubmission(ref, noPlan);
    expect(parsed.map((t) => [t.code, t.relevance])).toEqual([
      ["S", "routine"], // still covered by the plan footnote
      ["P", "opportunistic"],
      ["M", "routine"],
    ]);
  });
});

describe("FinnhubAdapter", () => {
  const raw: FinnhubRawBatch = {
    pages: [
      {
        symbol: "AAPL",
        data: [
          {
            name: "DOE JANE A",
            share: 150_000,
            change: -10_000,
            transactionDate: "2026-07-30",
            transactionCode: "S",
            transactionPrice: 228.4501,
            symbol: "AAPL",
          },
          {
            name: "SMITH ROBERT",
            share: 5_000,
            change: 2_000,
            transactionDate: "2026-07-29",
            transactionCode: "P",
            transactionPrice: 226.1,
            symbol: "AAPL",
          },
          {
            name: "BAD ROW",
            share: null,
            change: null,
            transactionDate: "2026-07-29",
            transactionCode: "??", // unknown code → dropped
            transactionPrice: null,
            symbol: "AAPL",
          },
        ],
      },
    ],
  };
  const txns = finnhubAdapter.normalize(raw);

  it("maps insider transactions, deriving A/D from the sign of change", () => {
    expect(txns).toHaveLength(2);
    for (const txn of txns) assertUnifiedShape(txn);
    expect(txns[0]).toMatchObject({
      source: "finnhub",
      code: "S",
      shares: 10_000,
      acquiredDisposed: "D",
      sharesOwnedAfter: 150_000,
      value: 2_284_501,
      relevance: "opportunistic", // no 10b5-1 signal available
    });
    expect(txns[0]!.company.externalKey).toBe("ticker:US:AAPL");
    expect(txns[0]!.insider.externalKey).toBe("name:US:DOE JANE A");
    expect(txns[1]).toMatchObject({ code: "P", acquiredDisposed: "A", shares: 2000 });
  });

  it("requires an API key", async () => {
    await expect(
      finnhubAdapter.fetch({ fetchFn: () => Promise.reject(new Error("no")), symbols: ["AAPL"] }),
    ).rejects.toBeInstanceOf(AdapterNotConfiguredError);
  });
});

describe("FMPAdapter", () => {
  const raw: FmpRawBatch = {
    pages: [
      {
        symbol: "MSFT",
        trades: [
          {
            symbol: "MSFT",
            transactionDate: "2026-07-28",
            reportingCik: "1513142",
            companyCik: "789019",
            transactionType: "P-Purchase",
            securitiesTransacted: 1500,
            price: 415.5,
            typeOfOwner: "officer: EVP, General Counsel",
            reportingName: "Hood Amy",
            acquisitionOrDisposition: "A",
          },
          {
            symbol: "MSFT",
            transactionDate: "2026-07-27",
            reportingCik: null,
            companyCik: "789019",
            transactionType: "S-Sale",
            securitiesTransacted: 800,
            price: 418,
            typeOfOwner: "director",
            reportingName: "Doe John",
            acquisitionOrDisposition: null,
          },
        ],
      },
    ],
  };
  const txns = fmpAdapter.normalize(raw);

  it("maps trades, parsing codes from transactionType and roles from typeOfOwner", () => {
    expect(txns).toHaveLength(2);
    for (const txn of txns) assertUnifiedShape(txn);
    expect(txns[0]).toMatchObject({
      source: "fmp",
      code: "P",
      rawCode: "P-Purchase",
      shares: 1500,
      value: 623_250,
      acquiredDisposed: "A",
      relevance: "opportunistic",
    });
    // CIK-based keys merge with EDGAR records for the same company/insider.
    expect(txns[0]!.company.externalKey).toBe("cik:0000789019");
    expect(txns[0]!.insider.externalKey).toBe("cik:0001513142");
    expect(txns[0]!.insider.isOfficer).toBe(true);
    expect(txns[1]!.insider.isDirector).toBe(true);
    expect(txns[1]!.acquiredDisposed).toBe("D"); // inferred from the S code
  });
});

describe("IndiaAdapter", () => {
  it("parses NSE-style dates", () => {
    expect(parseIndianDate("31-JUL-2026")).toBe("2026-07-31");
    expect(parseIndianDate("2026-07-31T00:00:00")).toBe("2026-07-31");
    expect(parseIndianDate("garbage")).toBeNull();
  });

  it("maps SEBI acquisition modes into the unified taxonomy", () => {
    expect(mapIndiaMode("Market Purchase", null)).toEqual({ code: "P", acquiredDisposed: "A" });
    expect(mapIndiaMode("Market Sale", "Sell")).toEqual({ code: "S", acquiredDisposed: "D" });
    expect(mapIndiaMode("ESOP", null)).toEqual({ code: "A", acquiredDisposed: "A" });
    expect(mapIndiaMode("Gift", "Sell")).toEqual({ code: "G", acquiredDisposed: "D" });
    expect(mapIndiaMode("Pledge Invocation", null)).toEqual({ code: "J", acquiredDisposed: null });
  });

  it("maps operator-supplied disclosure records to UnifiedTransactions in INR", () => {
    const raw: IndiaRawBatch = {
      records: [
        {
          symbol: "RELIANCE",
          company: "Reliance Industries Limited",
          acquirerName: "Kumar  Rajesh",
          personCategory: "Promoters",
          securityType: "Equity Shares",
          quantity: "1,00,000",
          value: "24,50,00,000",
          mode: "Market Purchase",
          transactionType: "Buy",
          date: "30-JUL-2026",
          exchange: "NSE",
        },
      ],
    };
    const txns = indiaAdapter.normalize(raw);
    expect(txns).toHaveLength(1);
    const txn = txns[0]!;
    assertUnifiedShape(txn);
    expect(txn).toMatchObject({
      source: "nse-bse",
      market: "IN",
      currency: "INR",
      code: "P",
      txnDate: "2026-07-30",
      shares: 100_000,
      value: 245_000_000,
      price: 2450,
      acquiredDisposed: "A",
      relevance: "opportunistic",
    });
    expect(txn.company.externalKey).toBe("ticker:IN:RELIANCE");
    expect(txn.insider.name).toBe("KUMAR RAJESH");
    expect(txn.insider.isTenPercentOwner).toBe(true); // Promoters → controlling shareholder
  });

  it("refuses to fetch without an operator-supplied feed URL (licensing)", async () => {
    await expect(
      indiaAdapter.fetch({ fetchFn: () => Promise.reject(new Error("no")) }),
    ).rejects.toBeInstanceOf(AdapterNotConfiguredError);
  });
});

describe("EU MAR / SEDI stubs", () => {
  it("normalize aggregator records but refuse to fetch", async () => {
    const raw = {
      records: [
        {
          symbol: "SAP",
          companyName: "SAP SE",
          insiderName: "Klein Christian",
          role: "CEO",
          side: "buy" as const,
          date: "2026-07-29",
          shares: 1000,
          price: 195.3,
        },
      ],
    };
    const eu = euMarAdapter.normalize(raw);
    expect(eu).toHaveLength(1);
    assertUnifiedShape(eu[0]!);
    expect(eu[0]).toMatchObject({ source: "eu-mar", currency: "EUR", code: "P", value: 195_300 });

    const ca = sediAdapter.normalize({ records: [{ ...raw.records[0]!, side: "sell" }] });
    expect(ca[0]).toMatchObject({ source: "sedi", currency: "CAD", code: "S" });

    await expect(
      euMarAdapter.fetch({ fetchFn: () => Promise.reject(new Error("no")) }),
    ).rejects.toBeInstanceOf(AdapterNotConfiguredError);
  });
});
