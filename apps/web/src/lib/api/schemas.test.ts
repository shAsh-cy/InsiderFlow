import { describe, expect, it } from "vitest";

import {
  heatmapQuerySchema,
  isScreenerPreset,
  leaderboardQuerySchema,
  politiciansQuerySchema,
  SCREENER_PRESETS,
  tradesQuerySchema,
} from "./schemas";

describe("tradesQuerySchema", () => {
  it("applies defaults on an empty query", () => {
    const q = tradesQuerySchema.parse({});
    expect(q).toMatchObject({ limit: 50, offset: 0, sort: "txn_date", order: "desc" });
  });

  it("coerces and normalizes values", () => {
    const q = tradesQuerySchema.parse({
      ticker: "aapl",
      market: "us",
      code: "P",
      relevance: "opportunistic",
      source: "finnhub",
      min_value_usd: "250000",
      cluster: "1",
      exec_only: "true",
      include_superseded: "false",
      from: "2026-07-01",
      limit: "25",
    });
    expect(q.ticker).toBe("AAPL");
    expect(q.market).toBe("US");
    expect(q.min_value_usd).toBe(250_000);
    expect(q.cluster).toBe(true);
    expect(q.exec_only).toBe(true);
    expect(q.include_superseded).toBe(false);
    expect(q.limit).toBe(25);
  });

  it("rejects invalid input", () => {
    expect(() => tradesQuerySchema.parse({ code: "QQ" })).toThrow();
    expect(() => tradesQuerySchema.parse({ limit: "500" })).toThrow();
    expect(() => tradesQuerySchema.parse({ from: "07/01/2026" })).toThrow();
    expect(() => tradesQuerySchema.parse({ insider_id: "not-a-uuid" })).toThrow();
    expect(() => tradesQuerySchema.parse({ sort: "sneaky" })).toThrow();
  });
});

describe("heatmapQuerySchema", () => {
  it("bounds the lookback window", () => {
    expect(heatmapQuerySchema.parse({}).days).toBe(30);
    expect(() => heatmapQuerySchema.parse({ days: "0" })).toThrow();
    expect(() => heatmapQuerySchema.parse({ days: "9999" })).toThrow();
  });

  it("keeps the Phase 4 defaults so existing clients are unaffected", () => {
    const q = heatmapQuerySchema.parse({});
    expect(q.group_by).toBe("company");
    expect(q.days).toBe(30);
    expect(q.limit).toBe(50);
  });

  it("resolves named timeframes, and lets an explicit `days` win", () => {
    expect(heatmapQuerySchema.parse({ timeframe: "7d" }).days).toBe(7);
    expect(heatmapQuerySchema.parse({ timeframe: "1y" }).days).toBe(365);
    expect(heatmapQuerySchema.parse({ timeframe: "1y", days: "10" }).days).toBe(10);
    expect(() => heatmapQuerySchema.parse({ timeframe: "3d" })).toThrow();
  });

  it("accepts the new grouping levels and rejects anything else", () => {
    expect(heatmapQuerySchema.parse({ group_by: "sector" }).group_by).toBe("sector");
    expect(heatmapQuerySchema.parse({ group_by: "country" }).group_by).toBe("country");
    expect(() => heatmapQuerySchema.parse({ group_by: "insider" })).toThrow();
  });
});

describe("politiciansQuerySchema", () => {
  it("normalizes tickers and bounds pagination", () => {
    const q = politiciansQuerySchema.parse({ ticker: "zztest", limit: "10" });
    expect(q.ticker).toBe("ZZTEST");
    expect(q.limit).toBe(10);
    expect(q.sort).toBe("disclosed_at"); // disclosure is the news, not the trade
    expect(() => politiciansQuerySchema.parse({ limit: "500" })).toThrow();
  });

  it("accepts every disclosed transaction type and rejects invented ones", () => {
    for (const txn_type of ["purchase", "sale", "sale_partial", "sale_full", "exchange"]) {
      expect(politiciansQuerySchema.parse({ txn_type }).txn_type).toBe(txn_type);
    }
    expect(() => politiciansQuerySchema.parse({ txn_type: "short" })).toThrow();
  });
});

describe("leaderboardQuerySchema", () => {
  it("defaults to a sample-size floor above 1", () => {
    const q = leaderboardQuerySchema.parse({});
    expect(q.metric).toBe("score");
    // A leaderboard of one-trade insiders would be a ranking of luck.
    expect(q.min_trades).toBeGreaterThan(1);
  });

  it("rejects an unknown metric", () => {
    expect(() => leaderboardQuerySchema.parse({ metric: "vibes" })).toThrow();
  });
});

describe("screener presets", () => {
  it("every preset produces valid trade-query params", () => {
    for (const [name, preset] of Object.entries(SCREENER_PRESETS)) {
      expect(isScreenerPreset(name)).toBe(true);
      // Presets merged over defaults must survive schema semantics.
      const merged = { ...tradesQuerySchema.parse({}), ...preset.params };
      expect(merged.limit).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(10);
    }
    expect(isScreenerPreset("nope")).toBe(false);
  });
});
