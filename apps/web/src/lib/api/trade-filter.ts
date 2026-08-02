import type { TradeRow } from "./queries";

export interface ClientTradeFilters {
  market?: string;
  side?: "buy" | "sell";
  relevance?: string;
  code?: string;
  source?: string;
  exec_only?: boolean;
  min_value_usd?: number;
}

/**
 * Client-side predicate matching the subset of trade filters that can be
 * evaluated on a row in isolation — used to filter live SSE arrivals so the
 * stream honors the active filter bar. SQL-only filters (cluster, dip,
 * near_low, sector) are intentionally excluded: live rows for those pass
 * through unfiltered rather than being wrongly dropped.
 */
export function matchesTradeFilters(trade: TradeRow, filters: ClientTradeFilters): boolean {
  if (filters.market && trade.market !== filters.market) return false;
  if (filters.side === "buy" && trade.acquiredDisposed !== "A") return false;
  if (filters.side === "sell" && trade.acquiredDisposed !== "D") return false;
  if (filters.relevance && trade.relevance !== filters.relevance) return false;
  if (filters.code && trade.code !== filters.code) return false;
  if (filters.source && trade.source !== filters.source) return false;
  if (filters.exec_only && !trade.insider.isOfficer) return false;
  if (
    filters.min_value_usd !== undefined &&
    (trade.valueUsd === null || trade.valueUsd < filters.min_value_usd)
  ) {
    return false;
  }
  return true;
}
