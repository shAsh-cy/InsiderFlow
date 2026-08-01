/**
 * Finnhub — US insider transactions + insider-sentiment (MSPR) aggregation.
 * Free tier: 60 calls/min (burst cap 30/sec) — the caller supplies a
 * rate-limited, cached fetchFn; this adapter never fetches unthrottled.
 */
import { normalizeInsiderName } from "../normalize";
import { isSecTransactionCode } from "../transaction-codes";
import { AdapterNotConfiguredError, buildTransaction } from "../unified";
import type { AdapterContext, MarketMetadata, SourceAdapter, UnifiedTransaction } from "../unified";

export const FINNHUB_MARKET: MarketMetadata = {
  market: "US",
  country: "US",
  currency: "USD",
  regulator: "SEC (aggregated by Finnhub)",
  disclosureDeadline: "2 business days (Exchange Act §16a-3)",
  latencyClass: "intraday",
};

export const FINNHUB_BASE = "https://finnhub.io/api/v1";

export function finnhubInsiderTransactionsUrl(
  symbol: string,
  token: string,
  from?: string,
): string {
  const fromParam = from ? `&from=${from.slice(0, 10)}` : "";
  return `${FINNHUB_BASE}/stock/insider-transactions?symbol=${encodeURIComponent(symbol)}${fromParam}&token=${token}`;
}

export function finnhubInsiderSentimentUrl(
  symbol: string,
  token: string,
  from: string,
  to: string,
): string {
  return `${FINNHUB_BASE}/stock/insider-sentiment?symbol=${encodeURIComponent(symbol)}&from=${from.slice(0, 10)}&to=${to.slice(0, 10)}&token=${token}`;
}

export interface FinnhubInsiderTransaction {
  name: string;
  /** Shares owned following the transaction. */
  share: number | null;
  /** Signed shares transacted: positive = acquired, negative = disposed. */
  change: number | null;
  filingDate?: string;
  transactionDate: string;
  /** SEC transaction code (Finnhub sources from EDGAR). */
  transactionCode: string;
  transactionPrice: number | null;
  symbol: string;
}

export interface FinnhubSymbolPage {
  symbol: string;
  data: FinnhubInsiderTransaction[];
}

export interface FinnhubRawBatch {
  pages: FinnhubSymbolPage[];
}

/** Monthly insider-sentiment point; MSPR ∈ [-100, 100] (Finnhub's monthly share purchase ratio). */
export interface FinnhubSentimentPoint {
  symbol: string;
  year: number;
  month: number;
  change: number | null;
  mspr: number | null;
}

function dataArray(payload: unknown): unknown[] {
  if (typeof payload !== "object" || payload === null) return [];
  const data = (payload as Record<string, unknown>).data;
  return Array.isArray(data) ? data : [];
}

export const finnhubAdapter = {
  id: "finnhub",
  metadata: FINNHUB_MARKET,

  async fetch(ctx: AdapterContext): Promise<FinnhubRawBatch> {
    if (!ctx.apiKey) throw new AdapterNotConfiguredError("finnhub", "FINNHUB_API_KEY is not set");
    const symbols = ctx.symbols ?? [];
    if (symbols.length === 0) {
      throw new AdapterNotConfiguredError("finnhub", "no watchlist symbols configured");
    }

    const pages: FinnhubSymbolPage[] = [];
    for (const symbol of symbols) {
      const response = await ctx.fetchFn(
        finnhubInsiderTransactionsUrl(symbol, ctx.apiKey, ctx.since),
      );
      if (!response.ok) {
        ctx.log?.("finnhub_fetch_failed", { symbol, status: response.status });
        continue;
      }
      const payload: unknown = JSON.parse(await response.text());
      pages.push({ symbol, data: dataArray(payload) as FinnhubInsiderTransaction[] });
    }
    return { pages };
  },

  normalize(raw: FinnhubRawBatch): UnifiedTransaction[] {
    const out: UnifiedTransaction[] = [];
    for (const page of raw.pages) {
      const symbol = page.symbol.trim().toUpperCase();
      for (const txn of page.data) {
        const code = (txn.transactionCode ?? "").trim().toUpperCase();
        const txnDate = txn.transactionDate?.slice(0, 10);
        if (!isSecTransactionCode(code) || !txnDate) continue;

        const change = typeof txn.change === "number" ? txn.change : null;
        const name = normalizeInsiderName(txn.name ?? "");
        const price =
          typeof txn.transactionPrice === "number" && txn.transactionPrice > 0
            ? txn.transactionPrice
            : null;

        out.push(
          buildTransaction({
            source: "finnhub",
            market: FINNHUB_MARKET.market,
            country: FINNHUB_MARKET.country,
            currency: FINNHUB_MARKET.currency,
            company: {
              externalKey: `ticker:US:${symbol}`,
              cik: null,
              name: symbol,
              ticker: symbol,
              country: FINNHUB_MARKET.country,
            },
            insider: {
              externalKey: `name:US:${name}`,
              name,
              isDirector: false,
              isOfficer: false,
              isTenPercentOwner: false,
              title: null,
            },
            filing: null,
            txnDate,
            code,
            rawCode: txn.transactionCode,
            shares: change === null ? null : Math.abs(change),
            price,
            acquiredDisposed: change === null ? null : change >= 0 ? "A" : "D",
            sharesOwnedAfter: typeof txn.share === "number" ? txn.share : null,
            is10b51: false, // Finnhub does not expose the 10b5-1 flag
            isDerivative: false,
            footnote: null,
          }),
        );
      }
    }
    return out;
  },

  /** Monthly insider-sentiment (MSPR) for the watchlist — cached by the caller. */
  async fetchSentiment(
    ctx: AdapterContext,
    from: string,
    to: string,
  ): Promise<FinnhubSentimentPoint[]> {
    if (!ctx.apiKey) throw new AdapterNotConfiguredError("finnhub", "FINNHUB_API_KEY is not set");
    const points: FinnhubSentimentPoint[] = [];
    for (const symbol of ctx.symbols ?? []) {
      const response = await ctx.fetchFn(finnhubInsiderSentimentUrl(symbol, ctx.apiKey, from, to));
      if (!response.ok) continue;
      const payload: unknown = JSON.parse(await response.text());
      for (const row of dataArray(payload)) {
        const r = row as Record<string, unknown>;
        if (typeof r.year !== "number" || typeof r.month !== "number") continue;
        points.push({
          symbol,
          year: r.year,
          month: r.month,
          change: typeof r.change === "number" ? r.change : null,
          mspr: typeof r.mspr === "number" ? r.mspr : null,
        });
      }
    }
    return points;
  },
} satisfies SourceAdapter<FinnhubRawBatch> & {
  fetchSentiment(ctx: AdapterContext, from: string, to: string): Promise<FinnhubSentimentPoint[]>;
};
