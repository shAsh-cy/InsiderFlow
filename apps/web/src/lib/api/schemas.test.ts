import { describe, expect, it } from "vitest";

import {
  heatmapQuerySchema,
  isScreenerPreset,
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
