/**
 * Congressional trading — STOCK Act periodic transaction reports (PTRs).
 *
 * SOURCE CHOICE (see docs/politicians.md for the full rationale):
 * The authoritative disclosures live at disclosures-clerk.house.gov and
 * efdsearch.senate.gov. Both publish PTRs as SCANNED PDFs behind a session
 * cookie and (for the Senate) an interstitial agreement form — there is no
 * machine-readable feed. Parsing them means OCR, which we cannot do reliably
 * in a free-tier pipeline and which would produce numbers we could not stand
 * behind.
 *
 * So the default source is the open house/senate-stock-watcher datasets:
 * volunteer transcriptions of those same public filings, published as plain
 * JSON in the public domain, with a link back to the original PDF on every
 * row. We store that `ptr_link` so any figure can be checked against the
 * filing it came from. Commercial APIs were rejected on ToS grounds: most
 * forbid redistribution, which is incompatible with an AGPL project.
 *
 * WHAT THE LAW REQUIRES (and what that means for the data):
 *  - PTRs are due within 45 days of a transaction over $1,000. A trade
 *    surfacing today may therefore be up to ~6 weeks old — the disclosure
 *    date is the news, not the transaction date.
 *  - Amounts are disclosed as BRACKETS, never exact figures. There is no
 *    true point value to recover, so none is invented: min and max are
 *    modelled separately and either may be null (an open-ended top bracket
 *    has no maximum).
 */
import { normalizeInsiderName } from "./normalize";

export type Chamber = "house" | "senate";
export type PoliticianTxnType = "purchase" | "sale" | "sale_partial" | "sale_full" | "exchange";

export interface RawPoliticianTrade {
  chamber: Chamber;
  politicianName: string;
  party: string | null;
  state: string | null;
  district: string | null;
  ticker: string | null;
  assetDescription: string;
  assetType: string | null;
  txnType: PoliticianTxnType;
  txnDate: string;
  disclosedAt: string | null;
  amountMin: number | null;
  amountMax: number | null;
  amountRange: string | null;
  owner: string | null;
  comment: string | null;
  sourceUrl: string | null;
  dedupKey: string;
}

export const HOUSE_STOCK_WATCHER_URL =
  "https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json";
export const SENATE_STOCK_WATCHER_URL =
  "https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json";

/**
 * Parse a disclosed amount bracket into min/max.
 *
 * "$1,001 - $15,000"    → { min: 1001,     max: 15000 }
 * "Over $50,000,000"    → { min: 50000000, max: null   }   open-ended top bracket
 * "$1,000,001 +"        → { min: 1000001,  max: null   }
 * "--" / "" / unknown   → { min: null,     max: null   }
 *
 * A single figure is treated as a FLOOR, never as an exact value — the filing
 * does not contain one, and inventing one would be a fabricated number.
 */
export function parseAmountRange(raw: string | null | undefined): {
  min: number | null;
  max: number | null;
  label: string | null;
} {
  if (!raw) return { min: null, max: null, label: null };
  const label = raw.trim();
  if (!label || label === "--") return { min: null, max: null, label: null };

  const figures = [...label.matchAll(/\$?\s*([\d,]+(?:\.\d+)?)/g)]
    .map((m) => Number(m[1]!.replaceAll(",", "")))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (figures.length === 0) return { min: null, max: null, label };
  if (figures.length === 1) return { min: figures[0]!, max: null, label };
  return { min: Math.min(...figures), max: Math.max(...figures), label };
}

/**
 * Render a disclosed bracket as text. THE ONLY renderer for a PTR amount.
 *
 * This lives in core, and is the single implementation, on purpose. The rule
 * it enforces — a STOCK Act filing has no exact figure, so we never print one
 * — was previously duplicated across the table, the RSS feed, and the alert
 * formatter. Three copies of a data-honesty rule is three chances for one of
 * them to quietly start printing a midpoint.
 *
 *   1001, 15000   → "$1,001–$15,000"
 *   50000000, null → "$50,000,000+"      open-ended top bracket
 *   null, 15000    → "up to $15,000"
 *   null, null     → the caller's phrasing for "nothing disclosed"
 */
export function formatAmountBracket(
  min: number | string | null,
  max: number | string | null,
  emptyLabel = "an undisclosed amount",
): string {
  const n = (v: number | string | null): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const parsed = typeof v === "number" ? v : Number(v);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
  const lo = n(min);
  const hi = n(max);
  if (lo !== null && hi !== null) return `${usd(lo)}–${usd(hi)}`;
  if (lo !== null) return `${usd(lo)}+`;
  if (hi !== null) return `up to ${usd(hi)}`;
  return emptyLabel;
}

const TXN_TYPE_MAP: Record<string, PoliticianTxnType> = {
  purchase: "purchase",
  p: "purchase",
  sale: "sale",
  s: "sale",
  sale_full: "sale_full",
  "sale (full)": "sale_full",
  "sale (full) ": "sale_full",
  sale_partial: "sale_partial",
  "sale (partial)": "sale_partial",
  exchange: "exchange",
  e: "exchange",
};

export function normalizePoliticianTxnType(
  raw: string | null | undefined,
): PoliticianTxnType | null {
  if (!raw) return null;
  return TXN_TYPE_MAP[raw.trim().toLowerCase()] ?? null;
}

/** MM/DD/YYYY or YYYY-MM-DD → YYYY-MM-DD. Returns null for anything else. */
export function normalizeDisclosureDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, month, day, year] = us;
    return `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
  }
  return null;
}

/** Strip honorifics so "Hon. Virginia Foxx" and "Virginia Foxx" are one person. */
export function normalizePoliticianName(raw: string): string {
  return normalizeInsiderName(
    raw
      .replace(/^\s*(hon\.?|mr\.?|mrs\.?|ms\.?|dr\.?|rep\.?|sen\.?|senator|representative)\s+/i, "")
      .trim(),
  );
}

export function politicianExternalKey(chamber: Chamber, name: string): string {
  return `${chamber}:${normalizePoliticianName(name)}`;
}

/**
 * Stable identity for one disclosed transaction. Ticker is not enough on its
 * own — a filer can disclose several trades of the same asset on the same day
 * in different brackets — so the bracket label and an occurrence suffix are
 * both part of the key.
 */
export function politicianDedupKey(
  trade: Omit<RawPoliticianTrade, "dedupKey">,
  occurrence = 0,
): string {
  const asset = trade.ticker ?? trade.assetDescription.slice(0, 40);
  return (
    [
      "pol",
      trade.chamber,
      normalizePoliticianName(trade.politicianName),
      trade.txnDate,
      asset.toUpperCase(),
      trade.txnType,
      trade.amountRange ?? "unknown",
    ].join("|") + `#${occurrence}`
  );
}

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed && trimmed !== "--" ? trimmed : null;
};

const cleanTicker = (raw: unknown): string | null => {
  const value = str(raw);
  if (!value) return null;
  // The datasets use "--", "N/A" and "" for non-equity assets.
  const upper = value.toUpperCase();
  if (upper === "N/A" || upper === "NONE") return null;
  return /^[A-Z][A-Z.-]{0,11}$/.test(upper) ? upper : null;
};

/**
 * Parse one stock-watcher record. Returns null when the row lacks the fields
 * that make it meaningful (a filer, a date, a resolvable transaction type) —
 * a partial row is dropped rather than stored with invented defaults.
 */
export function parseStockWatcherRecord(
  raw: unknown,
  chamber: Chamber,
): Omit<RawPoliticianTrade, "dedupKey"> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const politicianName = str(r.representative) ?? str(r.senator) ?? str(r.name);
  const txnDate = normalizeDisclosureDate(str(r.transaction_date));
  const txnType = normalizePoliticianTxnType(str(r.type) ?? str(r.transaction_type));
  if (!politicianName || !txnDate || !txnType) return null;

  const assetDescription = str(r.asset_description) ?? cleanTicker(r.ticker) ?? "Undisclosed asset";
  const amount = parseAmountRange(str(r.amount));

  // House rows carry "NC05"; the Senate dataset has no district.
  const district = str(r.district);
  const state = str(r.state) ?? (district ? district.slice(0, 2).toUpperCase() : null);

  return {
    chamber,
    politicianName,
    party: str(r.party),
    state,
    district,
    ticker: cleanTicker(r.ticker),
    assetDescription,
    assetType: str(r.asset_type),
    txnType,
    txnDate,
    disclosedAt: normalizeDisclosureDate(str(r.disclosure_date)),
    amountMin: amount.min,
    amountMax: amount.max,
    amountRange: amount.label,
    owner: str(r.owner)?.toLowerCase() ?? null,
    comment: str(r.comment),
    sourceUrl: str(r.ptr_link),
  };
}

/**
 * Parse a whole stock-watcher payload, assigning occurrence suffixes so two
 * genuinely identical disclosures on one day both survive the unique index.
 */
export function parseStockWatcherFeed(payload: unknown, chamber: Chamber): RawPoliticianTrade[] {
  if (!Array.isArray(payload)) return [];
  const seen = new Map<string, number>();
  const out: RawPoliticianTrade[] = [];

  for (const record of payload) {
    const parsed = parseStockWatcherRecord(record, chamber);
    if (!parsed) continue;
    const base = politicianDedupKey(parsed, 0).slice(0, -2);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    out.push({ ...parsed, dedupKey: `${base}#${occurrence}` });
  }
  return out;
}

/** Days between the transaction and its disclosure; null when either is missing. */
export function disclosureLagDays(txnDate: string, disclosedAt: string | null): number | null {
  if (!disclosedAt) return null;
  const from = Date.parse(`${txnDate}T00:00:00Z`);
  const to = Date.parse(`${disclosedAt}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

/** The STOCK Act filing deadline. Past this, a PTR is late. */
export const STOCK_ACT_DEADLINE_DAYS = 45;

export function isLateDisclosure(txnDate: string, disclosedAt: string | null): boolean {
  const lag = disclosureLagDays(txnDate, disclosedAt);
  return lag !== null && lag > STOCK_ACT_DEADLINE_DAYS;
}
