/**
 * FX helpers. Rates come from Frankfurter (ECB reference rates — free, no
 * API key, https://frankfurter.dev) and are cached in the fx_rates table by
 * the enrichment service.
 */

/** Historical rate endpoint: how many USD one unit of `currency` buys on `date`. */
export function frankfurterUrl(currency: string, dateIso: string): string {
  const date = dateIso.slice(0, 10);
  return `https://api.frankfurter.dev/v1/${date}?base=${encodeURIComponent(
    currency.toUpperCase(),
  )}&symbols=USD`;
}

/** Parse a Frankfurter response into the USD rate, or null when absent. */
export function parseFrankfurterRate(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const rates = (payload as Record<string, unknown>).rates;
  if (typeof rates !== "object" || rates === null) return null;
  const usd = (rates as Record<string, unknown>).USD;
  return typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? usd : null;
}

/** Convert a native-currency amount to USD; null-safe on both sides. */
export function toUsd(amount: number | null, rateUsd: number | null): number | null {
  if (amount === null || rateUsd === null) return null;
  return Math.round(amount * rateUsd * 10_000) / 10_000;
}
