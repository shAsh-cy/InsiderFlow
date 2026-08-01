import { describe, expect, it } from "vitest";

import { frankfurterUrl, parseFrankfurterRate, toUsd } from "./fx";
import { parseStooqCsv, stooqDailyUrl } from "./prices";

describe("fx", () => {
  it("builds the historical Frankfurter URL", () => {
    expect(frankfurterUrl("inr", "2026-07-30T12:00:00Z")).toBe(
      "https://api.frankfurter.dev/v1/2026-07-30?base=INR&symbols=USD",
    );
  });

  it("parses the USD rate from a Frankfurter response", () => {
    const payload = { amount: 1, base: "INR", date: "2026-07-30", rates: { USD: 0.0114 } };
    expect(parseFrankfurterRate(payload)).toBe(0.0114);
    expect(parseFrankfurterRate({ rates: {} })).toBeNull();
    expect(parseFrankfurterRate("garbage")).toBeNull();
    expect(parseFrankfurterRate(null)).toBeNull();
  });

  it("converts native amounts to USD", () => {
    expect(toUsd(245_000_000, 0.0114)).toBe(2_793_000);
    expect(toUsd(100, 1)).toBe(100);
    expect(toUsd(null, 1)).toBeNull();
    expect(toUsd(100, null)).toBeNull();
  });
});

describe("prices (Stooq)", () => {
  it("builds daily CSV URLs for supported markets and null for unsupported", () => {
    expect(stooqDailyUrl("AAPL", "US", "2026-07-30")).toBe(
      "https://stooq.com/q/d/l/?s=aapl.us&d1=20260730&d2=20260730&i=d",
    );
    expect(stooqDailyUrl("RELIANCE", "IN", "2026-07-30")).toBeNull();
  });

  it("parses a daily CSV", () => {
    const csv = "Date,Open,High,Low,Close,Volume\n2026-07-30,227.1,229.4,226.8,228.9,51234567\n";
    expect(parseStooqCsv(csv)).toEqual([
      {
        date: "2026-07-30",
        open: 227.1,
        high: 229.4,
        low: 226.8,
        close: 228.9,
        volume: 51_234_567,
      },
    ]);
  });

  it("handles 'No data' and malformed bodies", () => {
    expect(parseStooqCsv("No data")).toEqual([]);
    expect(parseStooqCsv("Date,Open,High,Low,Close,Volume\ngarbage,row\n")).toEqual([]);
  });
});
