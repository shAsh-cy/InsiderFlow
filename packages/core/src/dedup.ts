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
 * Suffix identities with per-batch occurrence counters: repeats WITHIN one
 * batch get "#0", "#1"... so legitimate duplicates survive, while the same
 * identity arriving in a LATER batch reproduces "#0" and dies on the
 * unique index. Used for transactions and the India disclosure tables.
 */
export function assignOccurrenceKeys(identities: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return identities.map((identity) => {
    const occurrence = seen.get(identity) ?? 0;
    seen.set(identity, occurrence + 1);
    return `${identity}#${occurrence}`;
  });
}

/**
 * Assign database dedup keys for a transaction batch (see
 * assignOccurrenceKeys for the occurrence-suffix semantics).
 */
export function assignDedupKeys(txns: readonly UnifiedTransaction[]): string[] {
  return assignOccurrenceKeys(txns.map(transactionIdentity));
}
