/**
 * Number/currency formatting for data-dense UI. INR uses Indian-market
 * notation (lakh/crore); everything else uses Western compact notation.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  INR: "₹",
  EUR: "€",
  CAD: "C$",
  GBP: "£",
};

export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
}

const trimZeros = (s: string): string => s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");

/** Western compact: 1234 → "1.23K", 2790000 → "2.79M". */
export function formatCompact(value: number, digits = 2): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${trimZeros((abs / 1e12).toFixed(digits))}T`;
  if (abs >= 1e9) return `${sign}${trimZeros((abs / 1e9).toFixed(digits))}B`;
  if (abs >= 1e6) return `${sign}${trimZeros((abs / 1e6).toFixed(digits))}M`;
  if (abs >= 1e3) return `${sign}${trimZeros((abs / 1e3).toFixed(digits))}K`;
  return `${sign}${trimZeros(abs.toFixed(digits))}`;
}

/** Indian-market compact: 24.5 crore → "24.5 Cr", 3.2 lakh → "3.2 L". */
export function formatIndianCompact(value: number, digits = 2): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}${trimZeros((abs / 1e7).toFixed(digits))} Cr`;
  if (abs >= 1e5) return `${sign}${trimZeros((abs / 1e5).toFixed(digits))} L`;
  return `${sign}${abs.toLocaleString("en-IN")}`;
}

/** Money in its native notation: INR → "₹24.5 Cr", USD → "$2.79M". */
export function formatMoney(value: number, currency: string): string {
  const symbol = currencySymbol(currency);
  return currency.toUpperCase() === "INR"
    ? `${symbol}${formatIndianCompact(value)}`
    : `${symbol}${formatCompact(value)}`;
}

/**
 * Dual display: native + USD when they differ, e.g. "₹24.5 Cr · $2.79M".
 * USD-native trades collapse to a single figure. Null → null (render
 * <NotDisclosed/> instead).
 */
export function formatDualCurrency(
  value: number | null,
  currency: string,
  valueUsd: number | null,
): string | null {
  if (value === null && valueUsd === null) return null;
  const isUsd = currency.toUpperCase() === "USD";
  if (isUsd) {
    const usd = valueUsd ?? value;
    return usd === null ? null : `$${formatCompact(usd)}`;
  }
  const native = value !== null ? formatMoney(value, currency) : null;
  const usd = valueUsd !== null ? `$${formatCompact(valueUsd)}` : null;
  if (native && usd) return `${native} · ${usd}`;
  return native ?? usd;
}

export function formatShares(value: number | null): string | null {
  if (value === null) return null;
  return value.toLocaleString("en-US");
}

export function formatPct(value: number, digits = 1): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

/** "2m ago" style timestamps for the live feed. */
/**
 * An absolute instant, in UTC, for "as of …" microtext.
 *
 * UTC rather than the reader's locale, and hand-formatted rather than
 * `toLocaleTimeString`: this string is rendered on the server and again
 * on the client, and any format that depends on the machine's timezone
 * or ICU data produces two different strings and a hydration mismatch.
 * The suffix is written out so the reader knows it is not their clock.
 */
export function utcClock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const hh = String(at.getUTCHours()).padStart(2, "0");
  const mm = String(at.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
