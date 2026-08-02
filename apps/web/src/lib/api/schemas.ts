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

export const heatmapQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  market: z.string().length(2).transform(upper).optional(),
  relevance: z.enum(["routine", "opportunistic"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type HeatmapQuery = z.infer<typeof heatmapQuerySchema>;

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
};

export function isScreenerPreset(name: string): name is keyof typeof SCREENER_PRESETS {
  return name in SCREENER_PRESETS;
}
