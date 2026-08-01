/**
 * India (NSE/BSE) — SEBI Prohibition of Insider Trading disclosures.
 *
 * LEGAL: NSE/BSE website data is published under restrictive terms; this
 * project does not scrape or redistribute it. The adapter normalizes
 * operator-supplied disclosure records — point INDIA_FEED_URL at a feed you
 * are licensed to use (or your own licensed mirror). Without it, fetch()
 * throws AdapterNotConfiguredError.
 */
import { normalizeInsiderName, parseFilingNumber } from "../normalize";
import type { SecTransactionCode } from "../transaction-codes";
import { AdapterNotConfiguredError, buildTransaction, rolesFromText } from "../unified";
import type { AdapterContext, MarketMetadata, SourceAdapter, UnifiedTransaction } from "../unified";

export const NSE_BSE_MARKET: MarketMetadata = {
  market: "IN",
  country: "IN",
  currency: "INR",
  regulator: "SEBI (PIT Regulations, 2015)",
  disclosureDeadline: "2 trading days (Reg. 7(2))",
  latencyClass: "delayed",
};

/** One SEBI PIT disclosure row, in the shape NSE/BSE publish (operator-supplied). */
export interface IndiaDisclosureRecord {
  symbol: string;
  company?: string | null;
  /** Reporting person. */
  acquirerName: string;
  /** "Promoters" | "Promoter Group" | "Director" | "KMP" | "Employee" | ... */
  personCategory?: string | null;
  securityType?: string | null;
  /** Quantity transacted (may arrive as "1,00,000"). */
  quantity?: number | string | null;
  /** Transaction value in INR. */
  value?: number | string | null;
  /** "Market Purchase" | "Market Sale" | "Off Market" | "ESOP" | "Gift" | "Pledge Invocation" | ... */
  mode?: string | null;
  /** "Buy" | "Sell" (some feeds provide this instead of / besides mode). */
  transactionType?: string | null;
  /** Transaction/intimation date — ISO or "31-JUL-2026". */
  date?: string | null;
  exchange?: string | null;
}

export interface IndiaRawBatch {
  records: IndiaDisclosureRecord[];
}

const MONTHS: Record<string, string> = {
  JAN: "01",
  FEB: "02",
  MAR: "03",
  APR: "04",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AUG: "08",
  SEP: "09",
  OCT: "10",
  NOV: "11",
  DEC: "12",
};

/** Accepts ISO dates or the "31-JUL-2026" style NSE uses. */
export function parseIndianDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const m = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const month = MONTHS[(m[2] as string).toUpperCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${(m[1] as string).padStart(2, "0")}`;
}

/** Map SEBI acquisition modes into the unified (SEC-derived) code taxonomy. */
export function mapIndiaMode(
  mode: string | null | undefined,
  transactionType: string | null | undefined,
): { code: SecTransactionCode; acquiredDisposed: "A" | "D" | null } {
  const m = (mode ?? "").toLowerCase();
  const t = (transactionType ?? "").toLowerCase();
  const isSell = t.includes("sell") || t.includes("sale") || m.includes("sale");
  const isBuy = t.includes("buy") || m.includes("purchase") || m.includes("acquisition");

  if (m.includes("esop") || m.includes("allot")) return { code: "A", acquiredDisposed: "A" };
  if (m.includes("gift")) return { code: "G", acquiredDisposed: isSell ? "D" : isBuy ? "A" : null };
  if (m.includes("will") || m.includes("inherit")) return { code: "W", acquiredDisposed: "A" };
  if (m.includes("pledge") || m.includes("invocation")) {
    return { code: "J", acquiredDisposed: isSell ? "D" : null };
  }
  if (isSell) return { code: "S", acquiredDisposed: "D" };
  if (isBuy) return { code: "P", acquiredDisposed: "A" };
  return { code: "J", acquiredDisposed: null };
}

export const indiaAdapter = {
  id: "nse-bse",
  metadata: NSE_BSE_MARKET,

  async fetch(ctx: AdapterContext): Promise<IndiaRawBatch> {
    if (!ctx.feedUrl) {
      throw new AdapterNotConfiguredError(
        "nse-bse",
        "NSE/BSE data is licensing-restricted; set INDIA_FEED_URL to a feed you are licensed to use",
      );
    }
    const response = await ctx.fetchFn(ctx.feedUrl);
    if (!response.ok) {
      throw new Error(`India feed responded ${response.status}`);
    }
    const payload: unknown = JSON.parse(await response.text());
    const records = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as Record<string, unknown>)?.data)
        ? ((payload as Record<string, unknown>).data as unknown[])
        : [];
    return { records: records as IndiaDisclosureRecord[] };
  },

  normalize(raw: IndiaRawBatch): UnifiedTransaction[] {
    const out: UnifiedTransaction[] = [];
    for (const record of raw.records) {
      const symbol = record.symbol?.trim().toUpperCase();
      const txnDate = parseIndianDate(record.date);
      if (!symbol || !txnDate) continue;

      const { code, acquiredDisposed } = mapIndiaMode(record.mode, record.transactionType);
      const name = normalizeInsiderName(record.acquirerName ?? "");
      const roles = rolesFromText(record.personCategory);
      const shares =
        typeof record.quantity === "number"
          ? Math.abs(record.quantity)
          : parseFilingNumber(record.quantity ?? null);
      const value =
        typeof record.value === "number"
          ? Math.abs(record.value)
          : parseFilingNumber(record.value ?? null);
      const price = shares !== null && shares > 0 && value !== null ? value / shares : null;

      out.push(
        buildTransaction({
          source: "nse-bse",
          market: NSE_BSE_MARKET.market,
          country: NSE_BSE_MARKET.country,
          currency: NSE_BSE_MARKET.currency,
          company: {
            externalKey: `ticker:IN:${symbol}`,
            cik: null,
            name: record.company?.trim() || symbol,
            ticker: symbol,
            country: NSE_BSE_MARKET.country,
          },
          insider: {
            externalKey: `name:IN:${name}`,
            name,
            isDirector: roles.isDirector,
            isOfficer: roles.isOfficer,
            // SEBI "Promoters" are controlling shareholders — closest unified role.
            isTenPercentOwner: roles.isTenPercentOwner,
            title: roles.title,
          },
          filing: null,
          txnDate,
          code,
          rawCode: record.mode?.trim() || record.transactionType?.trim() || "UNKNOWN",
          shares,
          price: price !== null ? Math.round(price * 10_000) / 10_000 : null,
          value,
          acquiredDisposed,
          sharesOwnedAfter: null,
          is10b51: false, // no 10b5-1 concept under SEBI PIT
          isDerivative: (record.securityType ?? "").toLowerCase().includes("derivative"),
          footnote: null,
        }),
      );
    }
    return out;
  },
} satisfies SourceAdapter<IndiaRawBatch>;
