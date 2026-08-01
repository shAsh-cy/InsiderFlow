/**
 * Financial Modeling Prep — US insider trading endpoint (free tier is
 * heavily capped: ~250 calls/day, so the caller must cache aggressively).
 */
import { normalizeCik, normalizeInsiderName } from "../normalize";
import { isSecTransactionCode } from "../transaction-codes";
import { AdapterNotConfiguredError, buildTransaction, rolesFromText } from "../unified";
import type { AdapterContext, MarketMetadata, SourceAdapter, UnifiedTransaction } from "../unified";

export const FMP_MARKET: MarketMetadata = {
  market: "US",
  country: "US",
  currency: "USD",
  regulator: "SEC (aggregated by FMP)",
  disclosureDeadline: "2 business days (Exchange Act §16a-3)",
  latencyClass: "daily",
};

export function fmpInsiderTradingUrl(symbol: string, apiKey: string, page = 0): string {
  return `https://financialmodelingprep.com/api/v4/insider-trading?symbol=${encodeURIComponent(symbol)}&page=${page}&apikey=${apiKey}`;
}

export interface FmpInsiderTrade {
  symbol: string;
  filingDate?: string;
  transactionDate: string;
  reportingCik?: string | null;
  companyCik?: string | null;
  /** e.g. "S-Sale", "P-Purchase", "A-Award", "M-Exempt". */
  transactionType: string;
  securitiesTransacted: number | null;
  price: number | null;
  /** e.g. "officer: EVP, General Counsel" or "director". */
  typeOfOwner?: string | null;
  reportingName: string;
  acquisitionOrDisposition?: string | null;
  link?: string | null;
}

export interface FmpSymbolPage {
  symbol: string;
  trades: FmpInsiderTrade[];
}

export interface FmpRawBatch {
  pages: FmpSymbolPage[];
}

export const fmpAdapter = {
  id: "fmp",
  metadata: FMP_MARKET,

  async fetch(ctx: AdapterContext): Promise<FmpRawBatch> {
    if (!ctx.apiKey) throw new AdapterNotConfiguredError("fmp", "FMP_API_KEY is not set");
    const symbols = ctx.symbols ?? [];
    if (symbols.length === 0) {
      throw new AdapterNotConfiguredError("fmp", "no watchlist symbols configured");
    }

    const pages: FmpSymbolPage[] = [];
    for (const symbol of symbols) {
      const response = await ctx.fetchFn(fmpInsiderTradingUrl(symbol, ctx.apiKey));
      if (!response.ok) {
        ctx.log?.("fmp_fetch_failed", { symbol, status: response.status });
        continue;
      }
      const payload: unknown = JSON.parse(await response.text());
      pages.push({ symbol, trades: Array.isArray(payload) ? (payload as FmpInsiderTrade[]) : [] });
    }
    return { pages };
  },

  normalize(raw: FmpRawBatch): UnifiedTransaction[] {
    const out: UnifiedTransaction[] = [];
    for (const page of raw.pages) {
      const symbol = page.symbol.trim().toUpperCase();
      for (const trade of page.trades) {
        // "S-Sale" → "S"; also accept a bare code.
        const code = (trade.transactionType ?? "").trim().charAt(0).toUpperCase();
        const txnDate = trade.transactionDate?.slice(0, 10);
        if (!isSecTransactionCode(code) || !txnDate) continue;

        const name = normalizeInsiderName(trade.reportingName ?? "");
        const roles = rolesFromText(trade.typeOfOwner);
        const ad = trade.acquisitionOrDisposition?.trim().toUpperCase();
        const shares =
          typeof trade.securitiesTransacted === "number"
            ? Math.abs(trade.securitiesTransacted)
            : null;

        out.push(
          buildTransaction({
            source: "fmp",
            market: FMP_MARKET.market,
            country: FMP_MARKET.country,
            currency: FMP_MARKET.currency,
            company: {
              // FMP exposes the issuer CIK, so rows merge with EDGAR's company records.
              externalKey: trade.companyCik
                ? `cik:${normalizeCik(trade.companyCik)}`
                : `ticker:US:${symbol}`,
              cik: trade.companyCik ? normalizeCik(trade.companyCik) : null,
              name: symbol,
              ticker: symbol,
              country: FMP_MARKET.country,
            },
            insider: {
              externalKey: trade.reportingCik
                ? `cik:${normalizeCik(trade.reportingCik)}`
                : `name:US:${name}`,
              name,
              isDirector: roles.isDirector,
              isOfficer: roles.isOfficer,
              isTenPercentOwner: roles.isTenPercentOwner,
              title: roles.title,
            },
            filing: null,
            txnDate,
            code,
            rawCode: trade.transactionType,
            shares,
            price: typeof trade.price === "number" && trade.price > 0 ? trade.price : null,
            acquiredDisposed:
              ad === "A" || ad === "D" ? ad : code === "P" ? "A" : code === "S" ? "D" : null,
            sharesOwnedAfter: null,
            is10b51: false, // FMP does not expose the 10b5-1 flag
            isDerivative: false,
            footnote: null,
          }),
        );
      }
    }
    return out;
  },
} satisfies SourceAdapter<FmpRawBatch>;
