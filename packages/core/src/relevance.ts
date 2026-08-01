/**
 * Routine-vs-opportunistic classifier.
 *
 * Most insider transactions are scheduled compensation plumbing (grants,
 * tax withholding, 10b5-1 plan executions) that carries little information.
 * The trades worth watching are the discretionary ones: open-market
 * purchases and sales the insider chose to make.
 *
 * Rules:
 *  - anything under a Rule 10b5-1 plan → routine (pre-scheduled)
 *  - F (tax withholding), A (grant/award), G (gift) → routine
 *  - exercises, conversions, expirations, transfers, etc. → routine
 *  - P (open-market purchase) and discretionary S (sale) → opportunistic
 */
export type Relevance = "routine" | "opportunistic";

export function classifyRelevance(txn: { code: string; is10b51?: boolean }): Relevance {
  if (txn.is10b51) return "routine";
  const code = txn.code.trim().toUpperCase();
  return code === "P" || code === "S" ? "opportunistic" : "routine";
}
