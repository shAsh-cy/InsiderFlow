/**
 * The pluggable source-adapter contract and the UnifiedTransaction model
 * every market normalizes into. Adding a market = implementing one
 * SourceAdapter; the schema and persistence layer stay untouched.
 */
import type { FetchLike, Logger } from "./http";
import { classifyRelevance } from "./relevance";
import type { Relevance } from "./relevance";
import type { SecTransactionCode } from "./transaction-codes";

export type SourceId = "edgar" | "nse-bse" | "finnhub" | "fmp" | "eu-mar" | "sedi";

/** How quickly a source surfaces new disclosures. */
export type LatencyClass = "realtime" | "intraday" | "daily" | "delayed";

export interface MarketMetadata {
  /** Exchange region identifier ("US", "IN", "EU", "CA"). */
  market: string;
  /** ISO 3166 country/region code. */
  country: string;
  /** Native reporting currency (ISO 4217). */
  currency: string;
  regulator: string;
  /** Human-readable statutory disclosure deadline. */
  disclosureDeadline: string;
  latencyClass: LatencyClass;
}

export interface AdapterContext {
  /** Already rate-limited and cached by the caller — adapters just call it. */
  fetchFn: FetchLike;
  apiKey?: string;
  userAgent?: string;
  /** Watchlist for symbol-scoped APIs (Finnhub, FMP). */
  symbols?: string[];
  /** ISO date lower bound for incremental fetches. */
  since?: string;
  /** Cap on how much to fetch in one call. */
  limit?: number;
  /** Operator-supplied feed URL (e.g. licensed NSE/BSE mirror). */
  feedUrl?: string;
  log?: Logger;
}

export interface SourceAdapter<TRaw = unknown> {
  readonly id: SourceId;
  readonly metadata: MarketMetadata;
  /** Pull raw payloads from the source. Throws AdapterNotConfiguredError when prerequisites are missing. */
  fetch(ctx: AdapterContext): Promise<TRaw>;
  /** Pure: map raw payloads into UnifiedTransactions. */
  normalize(raw: TRaw): UnifiedTransaction[];
}

export class AdapterNotConfiguredError extends Error {
  constructor(
    readonly sourceId: SourceId,
    reason: string,
  ) {
    super(`Source adapter "${sourceId}" is not configured: ${reason}`);
    this.name = "AdapterNotConfiguredError";
  }
}

export interface UnifiedCompany {
  /** Stable cross-run identity: "cik:0000320193", "ticker:US:AAPL", "isin:INE009A01021". */
  externalKey: string;
  name: string;
  ticker: string | null;
  cik: string | null;
  country: string;
}

export interface UnifiedInsider {
  /** "cik:0001214156" when the source provides one, else "name:<market>:<normalized name>". */
  externalKey: string;
  /** Normalized via normalizeInsiderName(). */
  name: string;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  title: string | null;
}

export interface UnifiedFiling {
  accessionNo: string;
  formType: string;
  /** ISO timestamp; null when the source only exposes a date. */
  filedAt: string | null;
  sourceUrl: string | null;
  rawXmlUrl: string | null;
  /** For amendments ("4/A"...): the date the original filing was submitted — used to link and supersede it. */
  originalFiledDate: string | null;
}

export interface UnifiedTransaction {
  source: SourceId;
  market: string;
  country: string;
  /** Native currency of price/value (ISO 4217). USD equivalents are attached at persist time via FX. */
  currency: string;
  company: UnifiedCompany;
  insider: UnifiedInsider;
  /** Present for filing-based sources (EDGAR); null for aggregator APIs. */
  filing: UnifiedFiling | null;
  /** ISO date (YYYY-MM-DD). */
  txnDate: string;
  /** Unified taxonomy: every market maps into the SEC-derived code set. */
  code: SecTransactionCode;
  /** Source-native code/mode as reported ("Market Purchase", "S-Sale", "S"...). */
  rawCode: string;
  shares: number | null;
  price: number | null;
  value: number | null;
  acquiredDisposed: "A" | "D" | null;
  sharesOwnedAfter: number | null;
  is10b51: boolean;
  isDerivative: boolean;
  footnote: string | null;
  relevance: Relevance;
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/**
 * Finish a transaction from adapter-mapped fields: derives value from
 * shares × price when the source did not report it, and classifies relevance.
 */
export function buildTransaction(
  base: Omit<UnifiedTransaction, "value" | "relevance"> & { value?: number | null },
): UnifiedTransaction {
  const value =
    base.value ??
    (base.shares !== null && base.price !== null ? round4(base.shares * base.price) : null);
  return {
    ...base,
    value,
    relevance: classifyRelevance({ code: base.code, is10b51: base.is10b51 }),
  };
}

const DIRECTOR_RE = /\bdirector\b|\bboard\b/i;
const OFFICER_RE =
  /officer|\bceo\b|\bcfo\b|\bcoo\b|\bcto\b|president|chief|\bvp\b|vice pres|treasurer|secretary|\bkmp\b|key managerial/i;
const OWNER_RE = /10%|ten percent|promoter|beneficial owner|major shareholder|substantial/i;

/**
 * Unify free-text role descriptions ("officer: EVP", "Promoters", "KMP",
 * "Director & CEO") into the canonical role flags.
 */
export function rolesFromText(roleText: string | null | undefined): {
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  title: string | null;
} {
  const text = (roleText ?? "").trim();
  return {
    isDirector: DIRECTOR_RE.test(text),
    isOfficer: OFFICER_RE.test(text),
    isTenPercentOwner: OWNER_RE.test(text),
    title: text.length > 0 ? text : null,
  };
}
