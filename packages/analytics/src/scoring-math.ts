/**
 * The scoring formulas, as pure functions.
 *
 * Split from the database job on purpose: every number published on a
 * leaderboard has to be reproducible from a documented formula, and a formula
 * you can only exercise through Postgres is one nobody will check. The
 * fixture test drives these directly; /docs/methodology states them in prose.
 *
 * INFORMATIONAL ONLY. These are backward-looking descriptive statistics on
 * public filings. They are not predictions and not investment advice.
 */

export const HORIZONS = [30, 90, 180] as const;
export type Horizon = (typeof HORIZONS)[number];

/** Benchmark symbol for US trades. SPY is free on Stooq and needs no licence. */
export const BENCHMARK_SYMBOL = "SPY";
export const BENCHMARK_MARKET = "US";

/**
 * Shrinkage prior. An insider with one lucky trade is indistinguishable from
 * an insider with one unlucky one, so the composite pulls small samples
 * toward zero: weight = n / (n + PRIOR_TRADES). At n=5 a score keeps half its
 * raw value; at n=45, 90%.
 */
export const PRIOR_TRADES = 5;

/** Simple return between two closes, as a fraction (0.1 = +10%). */
export function periodReturn(entry: number, exit: number): number | null {
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry <= 0) return null;
  return (exit - entry) / entry;
}

/**
 * Excess return over the benchmark, SIGNED BY DIRECTION.
 *
 * A buy is "right" when the stock beats the market; a sell is "right" when it
 * lags. Signing here is what makes buys and sells summable into one score —
 * without it a well-timed sale would score as a loss.
 */
export function signedExcess(
  assetReturn: number | null,
  benchmarkReturn: number | null,
  direction: "buy" | "sell",
): number | null {
  if (assetReturn === null || benchmarkReturn === null) return null;
  const excess = assetReturn - benchmarkReturn;
  return direction === "buy" ? excess : -excess;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Sample standard deviation (n−1). Returns null below two observations. */
export function stddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * The composite score, in percentage points.
 *
 *   score = mean(signed 90-day excess) × n / (n + 5) × 100
 *
 * One horizon, one statistic, one shrinkage term — deliberately simple, so
 * the leaderboard can be checked by hand from the per-trade table.
 */
export function compositeScore(excess90d: number[], priorTrades = PRIOR_TRADES): number | null {
  const avg = mean(excess90d);
  if (avg === null) return null;
  const n = excess90d.length;
  return avg * (n / (n + priorTrades)) * 100;
}

export function hitRate(excess: number[]): number | null {
  if (excess.length === 0) return null;
  return excess.filter((e) => e > 0).length / excess.length;
}

/**
 * Z-score of the current value against a trailing baseline.
 *
 * Each company is compared only to ITSELF: $2M of net buying is remarkable
 * for a micro-cap and noise for a mega-cap, so a cross-company ranking here
 * would be meaningless. Returns null when the baseline is too small or has no
 * dispersion — a z-score off 3 observations is not a signal.
 */
export function zScore(
  current: number,
  baseline: number[],
  minSample = 6,
): { z: number; mean: number; stddev: number } | null {
  if (baseline.length < minSample) return null;
  const m = mean(baseline)!;
  const sd = stddev(baseline);
  if (sd === null || sd === 0) return null;
  return { z: (current - m) / sd, mean: m, stddev: sd };
}

export interface RoundTripLot {
  /** Positive shares acquired, or negative shares disposed. */
  shares: number;
  price: number;
  date: string;
}

export interface RealizedResult {
  /** Number of closed buy→sell matches. */
  trades: number;
  /** Share-weighted realised return across all closed lots, as a fraction. */
  returnPct: number | null;
}

/**
 * FIFO round-trip matching: each sale is matched against the oldest unsold
 * buy lots. Sales with no prior buy on record are skipped rather than
 * assumed — we only see filed transactions, not the full position history,
 * so an unmatched sale means "we never saw the purchase", not "cost basis 0".
 */
export function realizedRoundTrips(lots: RoundTripLot[]): RealizedResult {
  const open: RoundTripLot[] = [];
  let matchedShares = 0;
  let weightedReturn = 0;
  let trades = 0;

  const chronological = [...lots].sort((a, b) => a.date.localeCompare(b.date));

  for (const lot of chronological) {
    if (lot.shares > 0) {
      open.push({ ...lot });
      continue;
    }
    let toClose = -lot.shares;
    while (toClose > 0 && open.length > 0) {
      const oldest = open[0]!;
      const take = Math.min(toClose, oldest.shares);
      if (oldest.price > 0) {
        weightedReturn += ((lot.price - oldest.price) / oldest.price) * take;
        matchedShares += take;
        trades++;
      }
      oldest.shares -= take;
      toClose -= take;
      if (oldest.shares <= 0) open.shift();
    }
  }

  return {
    trades,
    returnPct: matchedShares > 0 ? weightedReturn / matchedShares : null,
  };
}
