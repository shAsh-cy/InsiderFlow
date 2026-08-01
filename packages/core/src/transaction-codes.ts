/**
 * SEC Form 3/4/5 transaction codes.
 * Source: https://www.sec.gov/about/forms/form4data.pdf (public domain)
 */
export const SEC_TRANSACTION_CODES = {
  P: "Open market or private purchase of securities",
  S: "Open market or private sale of securities",
  V: "Transaction voluntarily reported earlier than required",
  A: "Grant, award, or other acquisition",
  D: "Sale (or disposition) back to the issuer",
  F: "Payment of exercise price or tax liability by delivering or withholding securities",
  I: "Discretionary transaction, which is an order to the broker to execute the transaction at the best possible price",
  M: "Exercise or conversion of derivative security",
  C: "Conversion of derivative security",
  E: "Expiration of short derivative position",
  H: "Expiration (or cancellation) of long derivative position with value received",
  O: "Exercise of out-of-the-money derivative security",
  X: "Exercise of in-the-money or at-the-money derivative security",
  G: "Bona fide gift",
  L: "Small acquisition under Rule 16a-6",
  W: "Acquisition or disposition by will or the laws of descent and distribution",
  Z: "Deposit into or withdrawal from voting trust",
  J: "Other acquisition or disposition (must be described in a footnote)",
  K: "Transaction in equity swap or instrument with similar characteristics",
  U: "Disposition pursuant to a tender of shares in a change of control transaction",
} as const;

export type SecTransactionCode = keyof typeof SEC_TRANSACTION_CODES;

export type TradeDirection = "buy" | "sell" | "neutral";

/**
 * Heuristic signal weight per code, in [-1, 1]. Positive = insider gaining
 * exposure (bullish), negative = reducing exposure (bearish), 0 = no signal.
 * Open-market purchases (P) and sales (S) carry full weight; grants,
 * exercises, and tax withholdings are discounted because they are usually
 * scheduled compensation events, not conviction trades.
 * Used for ranking and scoring only — NOT investment advice.
 */
export const TRANSACTION_SIGNAL_WEIGHTS: Record<SecTransactionCode, number> = {
  P: 1,
  A: 0.3,
  L: 0.2,
  M: 0.15,
  X: 0.15,
  C: 0.1,
  O: 0.1,
  V: 0,
  I: 0,
  G: 0,
  J: 0,
  K: 0,
  W: 0,
  Z: 0,
  E: 0,
  H: 0,
  F: -0.2,
  U: -0.4,
  D: -0.5,
  S: -1,
};

/** Codes where the insider is gaining / reducing exposure. Derived from the sign of the weights. */
const BUY_CODES: ReadonlySet<string> = new Set(["P", "A", "L", "M", "X", "C", "O"]);
const SELL_CODES: ReadonlySet<string> = new Set(["S", "D", "F", "U"]);

export function isSecTransactionCode(code: string): code is SecTransactionCode {
  return code in SEC_TRANSACTION_CODES;
}

/** Signal weight for a raw code string; unknown codes weigh 0. */
export function signalWeight(code: string): number {
  const normalized = code.trim().toUpperCase();
  return isSecTransactionCode(normalized) ? TRANSACTION_SIGNAL_WEIGHTS[normalized] : 0;
}

/**
 * Classify a transaction code as buy-side, sell-side, or neutral.
 * Informational codes (G, V, I, J, K, W, Z, E, H) and unknown codes are "neutral".
 */
export function classifyTransaction(code: string): TradeDirection {
  const normalized = code.trim().toUpperCase();
  if (BUY_CODES.has(normalized)) return "buy";
  if (SELL_CODES.has(normalized)) return "sell";
  return "neutral";
}
