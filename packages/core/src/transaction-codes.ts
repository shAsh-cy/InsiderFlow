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

/** Heuristic mapping of transaction codes to buy/sell pressure, used for display and alerts. */
const BUY_CODES: ReadonlySet<string> = new Set(["P", "A", "M", "C", "X", "L"]);
const SELL_CODES: ReadonlySet<string> = new Set(["S", "D", "F", "E", "H", "O", "U"]);

export function isSecTransactionCode(code: string): code is SecTransactionCode {
  return code in SEC_TRANSACTION_CODES;
}

/**
 * Classify a transaction code as buy-side, sell-side, or neutral.
 * Unknown or informational codes (G, V, I, J, K, W, Z) are "neutral".
 */
export function classifyTransaction(code: string): TradeDirection {
  const normalized = code.trim().toUpperCase();
  if (BUY_CODES.has(normalized)) return "buy";
  if (SELL_CODES.has(normalized)) return "sell";
  return "neutral";
}
