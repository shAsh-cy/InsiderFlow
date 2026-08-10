import { SEC_TRANSACTION_CODES } from "@insiderflow/core";

/**
 * The filter vocabulary, in one place.
 *
 * The bar and the bottom sheet are two presentations of the same set, and
 * a set defined twice is a set that drifts: the sheet would keep offering
 * a source the bar had dropped, and only the half of the users on phones
 * would ever see it.
 */

export const MARKETS = [
  { value: "", label: "All markets" },
  { value: "US", label: "🇺🇸 US" },
  { value: "IN", label: "🇮🇳 India" },
] as const;

export const MIN_VALUES = [
  { label: "Any value", value: "" },
  { label: "$100K+", value: "100000" },
  { label: "$250K+", value: "250000" },
  { label: "$1M+", value: "1000000" },
  { label: "$5M+", value: "5000000" },
] as const;

export const SOURCE_OPTIONS = [
  { value: "", label: "Any source" },
  { value: "edgar", label: "EDGAR" },
  { value: "finnhub", label: "Finnhub" },
  { value: "fmp", label: "FMP" },
  { value: "nse-bse", label: "NSE/BSE" },
] as const;

export const ROLE_OPTIONS = [
  { value: "", label: "Any role" },
  { value: "officer", label: "Officers" },
  { value: "director", label: "Directors" },
  { value: "ten_pct", label: "10% owners" },
] as const;

/**
 * Truncated to 18 characters, not 40.
 *
 * A native <select> sizes itself to its widest option and, as a flex item,
 * its automatic minimum size is that intrinsic width — form controls do
 * not shrink below their content. At 40 characters of description this
 * control was ~300px wide against a 312px content well at 360px: within a
 * handful of pixels of dragging the whole page sideways, and past it at
 * any browser minimum-font-size setting. The full description is on the
 * code legend, where there is room to read it.
 */
export const CODE_OPTIONS = [
  { value: "", label: "Any code" },
  ...Object.keys(SEC_TRANSACTION_CODES).map((code) => ({
    value: code,
    label: `${code} — ${SEC_TRANSACTION_CODES[code as keyof typeof SEC_TRANSACTION_CODES].slice(0, 18)}`,
  })),
];

export interface FilterToggle {
  key: string;
  value: string;
  label: string;
  /** Stays on the page below md, in the scrolling primary row. */
  primary?: boolean;
  /** Only offered on /screener. */
  advanced?: boolean;
}

/** Boolean-ish chips: one query key, one value that turns it on. */
export const TOGGLES: readonly FilterToggle[] = [
  { key: "side", value: "buy", label: "Buys", primary: true },
  { key: "side", value: "sell", label: "Sells", primary: true },
  { key: "relevance", value: "opportunistic", label: "Opportunistic" },
  { key: "exec_only", value: "true", label: "Executives only" },
  { key: "cluster", value: "true", label: "Cluster buys", advanced: true },
  { key: "dip", value: "true", label: "Dip buys", advanced: true },
  { key: "near_low", value: "true", label: "Near 52-wk low", advanced: true },
];
