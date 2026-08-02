import { describe, expect, it } from "vitest";

import type { TradeRow } from "./queries";
import { matchesTradeFilters } from "./trade-filter";

const trade = (overrides: Partial<TradeRow> = {}): TradeRow =>
  ({
    id: "t",
    source: "edgar",
    market: "US",
    txnDate: "2026-07-30",
    code: "P",
    rawCode: "P",
    direction: "buy",
    relevance: "opportunistic",
    signalWeight: 1,
    shares: 100,
    price: 10,
    value: 1000,
    currency: "USD",
    priceUsd: 10,
    valueUsd: 1000,
    acquiredDisposed: "A",
    sharesOwnedAfter: null,
    is10b51: false,
    isDerivative: false,
    footnote: null,
    createdAt: "2026-08-02T10:00:00.000Z",
    company: { id: "c", ticker: "AAPL", name: "Apple" },
    insider: {
      id: "i",
      name: "DOE JANE",
      title: null,
      isDirector: false,
      isOfficer: true,
      isTenPctOwner: false,
    },
    filing: null,
    ...overrides,
  }) as TradeRow;

describe("matchesTradeFilters", () => {
  it("passes everything with no filters", () => {
    expect(matchesTradeFilters(trade(), {})).toBe(true);
  });

  it("matches the live-stream-evaluable filters", () => {
    expect(matchesTradeFilters(trade(), { market: "IN" })).toBe(false);
    expect(matchesTradeFilters(trade(), { side: "sell" })).toBe(false);
    expect(matchesTradeFilters(trade({ acquiredDisposed: "D" }), { side: "sell" })).toBe(true);
    expect(matchesTradeFilters(trade(), { relevance: "routine" })).toBe(false);
    expect(matchesTradeFilters(trade(), { code: "S" })).toBe(false);
    expect(matchesTradeFilters(trade(), { source: "finnhub" })).toBe(false);
    expect(matchesTradeFilters(trade(), { exec_only: true })).toBe(true);
    expect(
      matchesTradeFilters(trade({ insider: { ...trade().insider, isOfficer: false } }), {
        exec_only: true,
      }),
    ).toBe(false);
  });

  it("treats null USD value as failing a min-value filter (never fabricates)", () => {
    expect(matchesTradeFilters(trade(), { min_value_usd: 500 })).toBe(true);
    expect(matchesTradeFilters(trade(), { min_value_usd: 5000 })).toBe(false);
    expect(matchesTradeFilters(trade({ valueUsd: null }), { min_value_usd: 1 })).toBe(false);
  });
});
