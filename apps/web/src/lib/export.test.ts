import { describe, expect, it } from "vitest";

import type { TradeRow } from "./api/queries";
import { toCsv, tradesToExportRows } from "./export";

const trade = (overrides: Partial<TradeRow> = {}): TradeRow =>
  ({
    id: "t1",
    source: "edgar",
    market: "US",
    txnDate: "2026-07-30",
    code: "P",
    rawCode: "P",
    direction: "buy",
    relevance: "opportunistic",
    signalWeight: 1,
    shares: 2500,
    price: 226.1,
    value: 565_250,
    currency: "USD",
    priceUsd: 226.1,
    valueUsd: 565_250,
    acquiredDisposed: "A",
    sharesOwnedAfter: null,
    is10b51: false,
    isDerivative: false,
    footnote: null,
    createdAt: "2026-08-02T10:00:00.000Z",
    company: { id: "c1", ticker: "AAPL", name: "Apple, Inc." },
    insider: {
      id: "i1",
      name: 'DOE "JJ" JANE',
      title: "CFO",
      isDirector: true,
      isOfficer: true,
      isTenPctOwner: false,
    },
    filing: null,
    ...overrides,
  }) as TradeRow;

describe("tradesToExportRows", () => {
  it("flattens a trade with nulls preserved (never fabricated)", () => {
    const [row] = tradesToExportRows([trade({ value: null, valueUsd: null })]);
    expect(row).toMatchObject({
      date: "2026-07-30",
      ticker: "AAPL",
      code: "P",
      value: null,
      value_usd: null,
      rule_10b5_1: false,
    });
  });
});

describe("toCsv", () => {
  it("escapes quotes and commas per RFC 4180", () => {
    const csv = toCsv(tradesToExportRows([trade()]));
    const [header, dataRow] = csv.split("\r\n");
    expect(header).toContain("date,market,ticker,company,insider");
    expect(dataRow).toContain('"Apple, Inc."'); // comma → quoted
    expect(dataRow).toContain('"DOE ""JJ"" JANE"'); // quotes → doubled
  });

  it("renders nulls as empty cells and handles empty input", () => {
    const csv = toCsv(tradesToExportRows([trade({ shares: null })]));
    expect(csv.split("\r\n")[1]).toContain(",,"); // empty cell, not "null"
    expect(toCsv([])).toBe("");
  });
});
