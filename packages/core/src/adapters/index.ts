import type { SourceAdapter, SourceId } from "../unified";
import { edgarAdapter } from "./edgar";
import { finnhubAdapter } from "./finnhub";
import { fmpAdapter } from "./fmp";
import { indiaAdapter } from "./india";
import { euMarAdapter, sediAdapter } from "./stubs";

export {
  EDGAR_MARKET,
  edgarAdapter,
  normalizeEdgarSubmission,
  parseEdgarSubmission,
} from "./edgar";
export type { EdgarNormalizedSubmission, EdgarRawBatch, EdgarSubmission } from "./edgar";
export {
  FINNHUB_BASE,
  FINNHUB_MARKET,
  finnhubAdapter,
  finnhubInsiderSentimentUrl,
  finnhubInsiderTransactionsUrl,
} from "./finnhub";
export type {
  FinnhubInsiderTransaction,
  FinnhubRawBatch,
  FinnhubSentimentPoint,
  FinnhubSymbolPage,
} from "./finnhub";
export { FMP_MARKET, fmpAdapter, fmpInsiderTradingUrl } from "./fmp";
export type { FmpInsiderTrade, FmpRawBatch, FmpSymbolPage } from "./fmp";
export { NSE_BSE_MARKET, indiaAdapter, mapIndiaMode, parseIndianDate } from "./india";
export type { IndiaDisclosureRecord, IndiaRawBatch } from "./india";
export { euMarAdapter, sediAdapter } from "./stubs";
export type { AggregatorRawBatch, AggregatorRecord } from "./stubs";

/** Registry of every known source adapter. */
export const SOURCE_ADAPTERS: Record<SourceId, SourceAdapter<unknown>> = {
  edgar: edgarAdapter,
  "nse-bse": indiaAdapter,
  finnhub: finnhubAdapter,
  fmp: fmpAdapter,
  "eu-mar": euMarAdapter,
  sedi: sediAdapter,
};

export function getSourceAdapter(id: SourceId): SourceAdapter<unknown> {
  return SOURCE_ADAPTERS[id];
}
