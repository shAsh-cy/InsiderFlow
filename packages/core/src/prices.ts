/**
 * Daily price context via Stooq (free, no API key). Alternatives on the
 * free tier: Yahoo's unofficial chart API, Alpha Vantage (25 req/day).
 * Parsed rows are cached in the daily_prices table by the enrichment service.
 */

/** Stooq symbol suffix per market; markets Stooq does not cover return null. */
const STOOQ_MARKET_SUFFIX: Record<string, string> = {
  US: "us",
  UK: "uk",
  DE: "de",
  JP: "jp",
  HU: "hu",
  PL: "pl",
};

/** CSV download URL for one day of OHLCV, or null when the market is unsupported. */
export function stooqDailyUrl(ticker: string, market: string, dateIso: string): string | null {
  const suffix = STOOQ_MARKET_SUFFIX[market.toUpperCase()];
  if (!suffix) return null;
  const d = dateIso.slice(0, 10).replaceAll("-", "");
  const symbol = `${ticker.trim().toLowerCase()}.${suffix}`;
  return `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&d1=${d}&d2=${d}&i=d`;
}

export interface DailyPriceRow {
  /** ISO date. */
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

const num = (raw: string | undefined): number | null => {
  if (raw === undefined || raw.length === 0) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** Parse a Stooq daily CSV (Date,Open,High,Low,Close,Volume). Handles "No data" bodies. */
export function parseStooqCsv(csv: string): DailyPriceRow[] {
  const rows: DailyPriceRow[] = [];
  for (const line of csv.split("\n").slice(1)) {
    const cols = line.trim().split(",");
    const date = cols[0];
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const close = num(cols[4]);
    if (close === null) continue;
    rows.push({
      date,
      open: num(cols[1]),
      high: num(cols[2]),
      low: num(cols[3]),
      close,
      volume: num(cols[5]),
    });
  }
  return rows;
}
