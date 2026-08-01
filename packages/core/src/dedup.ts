/**
 * Cross-source deduplication. The same trade often arrives from multiple
 * sources (EDGAR filing + Finnhub's aggregation of it). Identity is defined
 * on fields every source reports: (market, company, insider, date, shares, code).
 */
import { normalizeInsiderName } from "./normalize";
import type { UnifiedTransaction } from "./unified";

/** Cross-source identity of a trade. Sources use tickers or CIKs for the company; prefer ticker (shared), fall back to name. */
export function transactionIdentity(txn: UnifiedTransaction): string {
  const company = (txn.company.ticker ?? txn.company.name).trim().toUpperCase();
  const insider = normalizeInsiderName(txn.insider.name);
  const shares = txn.shares === null ? "?" : String(Math.abs(txn.shares));
  return [txn.market, company, insider, txn.txnDate, shares, txn.code].join("|");
}

/**
 * Assign database dedup keys for a batch. Legitimate repeats WITHIN one
 * batch (e.g. two identical lots in one Form 4) get "#0", "#1"... suffixes;
 * the same trade arriving later from another source produces the same
 * "#0" key and is rejected by the unique index.
 */
export function assignDedupKeys(txns: readonly UnifiedTransaction[]): string[] {
  const seen = new Map<string, number>();
  return txns.map((txn) => {
    const identity = transactionIdentity(txn);
    const occurrence = seen.get(identity) ?? 0;
    seen.set(identity, occurrence + 1);
    return `${identity}#${occurrence}`;
  });
}
