import { SEC_TRANSACTION_CODES } from "@insiderflow/core";
import { z } from "zod";

const CODES = Object.keys(SEC_TRANSACTION_CODES) as [string, ...string[]];

/** Accepts true/false/1/0 — query strings have no real booleans. */
const boolish = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const upper = (s: string) => s.trim().toUpperCase();

export const tradesQuerySchema = z.object({
  market: z.string().length(2).transform(upper).optional(),
  ticker: z.string().min(1).max(12).transform(upper).optional(),
  code: z.enum(CODES).optional(),
  role: z.enum(["director", "officer", "ten_pct"]).optional(),
  relevance: z.enum(["routine", "opportunistic"]).optional(),
  source: z.enum(["edgar", "nse-bse", "finnhub", "fmp", "eu-mar", "sedi"]).optional(),
  /** Acquired (buy) vs disposed (sell) side of the trade. */
  side: z.enum(["buy", "sell"]).optional(),
  sector: z.string().min(1).max(64).optional(),
  /** Trades priced within 5% of the 52-week low — only where price context exists. */
  near_low: boolish.optional(),
  insider_id: z.string().uuid().optional(),
  min_value: z.coerce.number().positive().optional(),
  min_value_usd: z.coerce.number().positive().optional(),
  /** ≥2 distinct insiders bought (code P) the same company within 14 days. */
  cluster: boolish.optional(),
  /** Purchases priced below that day's close (requires cached price context). */
  dip: boolish.optional(),
  /**
   * Companies whose current net insider flow is at least N standard
   * deviations from their OWN trailing baseline (see /docs/methodology).
   */
  min_anomaly_z: z.coerce.number().min(0).max(20).optional(),
  exec_only: boolish.optional(),
  include_superseded: boolish.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  sort: z.enum(["txn_date", "value", "value_usd", "created_at"]).default("txn_date"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type TradesQuery = z.infer<typeof tradesQuerySchema>;

/** Named timeframes for the heatmap. `days` still works and wins if both are sent. */
export const TIMEFRAMES = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "1y": 365,
} as const;
export type Timeframe = keyof typeof TIMEFRAMES;

export const heatmapQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(365).optional(),
    timeframe: z.enum(Object.keys(TIMEFRAMES) as [Timeframe, ...Timeframe[]]).optional(),
    group_by: z.enum(["company", "sector", "country"]).default("company"),
    market: z.string().length(2).transform(upper).optional(),
    sector: z.string().min(1).max(64).optional(),
    relevance: z.enum(["routine", "opportunistic"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .transform((q) => ({
    ...q,
    // Explicit `days` beats the named timeframe; the 30-day default is
    // unchanged from Phase 4, so existing clients see identical behaviour.
    days: q.days ?? (q.timeframe ? TIMEFRAMES[q.timeframe] : 30),
  }));
export type HeatmapQuery = z.infer<typeof heatmapQuerySchema>;

export const leaderboardQuerySchema = z.object({
  /** Which statistic ranks the table. */
  metric: z.enum(["score", "avg_excess_90d", "hit_rate_90d", "realized"]).default("score"),
  order: z.enum(["asc", "desc"]).default("desc"),
  /** Sample-size floor. Below it a ranking is noise, so the default is not 1. */
  min_trades: z.coerce.number().int().min(1).max(500).default(5),
  role: z.enum(["director", "officer", "ten_pct"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

export const politiciansQuerySchema = z.object({
  ticker: z.string().min(1).max(12).transform(upper).optional(),
  politician_id: z.string().uuid().optional(),
  chamber: z.enum(["house", "senate"]).optional(),
  party: z.string().min(1).max(32).optional(),
  txn_type: z.enum(["purchase", "sale", "sale_partial", "sale_full", "exchange"]).optional(),
  side: z.enum(["buy", "sell"]).optional(),
  /** Matches on the disclosed UPPER bound — the filing has no exact figure. */
  min_amount_usd: z.coerce.number().positive().optional(),
  /** Disclosed more than 45 days after the trade (STOCK Act deadline). */
  late_only: boolish.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  sort: z.enum(["disclosed_at", "txn_date", "amount"]).default("disclosed_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type PoliticiansQuery = z.infer<typeof politiciansQuerySchema>;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const tickerParamSchema = z.string().min(1).max(12).transform(upper);
export const uuidParamSchema = z.string().uuid();

/** Canned screens: preset params override user filters, everything else composes. */
export const SCREENER_PRESETS: Record<
  string,
  { description: string; params: Partial<TradesQuery> }
> = {
  latest: {
    description: "Most recent insider transactions across all markets",
    params: {},
  },
  "big-buys": {
    description: "Discretionary open-market purchases worth $250k+ (USD)",
    params: { code: "P", relevance: "opportunistic", min_value_usd: 250_000 },
  },
  "cluster-buys": {
    description: "Purchases at companies where 2+ insiders bought within 14 days",
    params: { code: "P", cluster: true },
  },
  "exec-buys": {
    description: "Discretionary purchases by officers (CEO/CFO/...)",
    params: { code: "P", relevance: "opportunistic", exec_only: true },
  },
  "dip-buys": {
    description: "Purchases priced below that day's market close",
    params: { code: "P", dip: true },
  },
  "big-discretionary-sales": {
    description: "Non-10b5-1 sales worth $1M+ (USD)",
    params: { code: "S", relevance: "opportunistic", min_value_usd: 1_000_000 },
  },
  "unusual-flow": {
    description:
      "Trades at companies whose net insider flow is 2+ standard deviations from their own trailing baseline",
    params: { relevance: "opportunistic", min_anomaly_z: 2 },
  },
};

export function isScreenerPreset(name: string): name is keyof typeof SCREENER_PRESETS {
  return name in SCREENER_PRESETS;
}
