/**
 * SEC EDGAR endpoints and feed/index parsers.
 * Fair-access policy (https://www.sec.gov/os/accessing-edgar-data):
 * declare a descriptive User-Agent and stay under 10 requests/second —
 * a missing or generic UA gets 403'd.
 */
import { XMLParser } from "fast-xml-parser";

import { normalizeAccessionNumber, normalizeCik } from "./normalize";

export const EDGAR_BASE = "https://www.sec.gov";

/** A filing discovered in a feed or index — enough to fetch and ingest it. */
export interface EdgarFilingRef {
  /** Canonical dashed accession number. */
  accessionNo: string;
  /** Any CIK associated with the filing (issuer or owner) — either resolves the archive path. */
  cik: string;
  /** Raw form type as listed ("4", "4/A", "3", "5"...). */
  formType: string;
  /** ISO timestamp when known (feed <updated> or index date). */
  filedAt: string | null;
  /** Human-facing filing page when known. */
  sourceUrl: string | null;
}

/** Atom feed of the most recent filings of one form type, newest first. */
export function edgarCurrentFeedUrl(formType: string, count = 100): string {
  return `${EDGAR_BASE}/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(
    formType,
  )}&company=&dateb=&owner=include&count=${count}&output=atom`;
}

/** Complete submission text file — contains the ownershipDocument XML inline. */
export function edgarSubmissionTextUrl(cik: string | number, accessionNo: string): string {
  const cikNoPad = Number(normalizeCik(cik));
  return `${EDGAR_BASE}/Archives/edgar/data/${cikNoPad}/${normalizeAccessionNumber(accessionNo)}.txt`;
}

/** Daily form index (one per business day) used for backfills. */
export function edgarDailyFormIdxUrl(date: Date): string {
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${EDGAR_BASE}/Archives/edgar/daily-index/${year}/QTR${quarter}/form.${year}${month}${day}.idx`;
}

const feedParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // The live feed has hundreds of entries with &amp;-heavy URLs, which trips
  // fast-xml-parser's entity-expansion safety limit. Nothing we extract from
  // the feed (archive paths, accession numbers, dates, form types) contains
  // entities, so skip entity processing entirely.
  processEntities: false,
  isArray: (tagName) => tagName === "entry" || tagName === "link" || tagName === "category",
});

const ACCESSION_RE = /(\d{10}-\d{2}-\d{6})/;
const CIK_PATH_RE = /\/data\/(\d{1,10})\//;

function get(v: unknown, key: string): unknown {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>)[key] : undefined;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Parse EDGAR's "current events" Atom feed into filing refs, deduplicated by
 * accession number (each filing is listed once per associated company/owner).
 */
export function parseCurrentFeed(atomXml: string): EdgarFilingRef[] {
  const feed = get(feedParser.parse(atomXml), "feed");
  const entries = get(feed, "entry");
  const seen = new Map<string, EdgarFilingRef>();

  for (const entry of Array.isArray(entries) ? entries : []) {
    const links = get(entry, "link");
    const href = asString(get(Array.isArray(links) ? links[0] : links, "@_href"));
    const id = asString(get(entry, "id"));

    const accessionMatch = (href ?? "").match(ACCESSION_RE) ?? (id ?? "").match(ACCESSION_RE);
    const cikMatch = (href ?? "").match(CIK_PATH_RE);
    if (!accessionMatch || !cikMatch) continue;

    const accessionNo = accessionMatch[1] as string;
    if (seen.has(accessionNo)) continue;

    const categories = get(entry, "category");
    const formType =
      asString(get(Array.isArray(categories) ? categories[0] : categories, "@_term")) ??
      (asString(get(entry, "title")) ?? "").split(" - ")[0]?.trim() ??
      "4";

    seen.set(accessionNo, {
      accessionNo,
      cik: normalizeCik(cikMatch[1] as string),
      formType,
      filedAt: asString(get(entry, "updated")),
      sourceUrl: href,
    });
  }
  return [...seen.values()];
}

// form.idx line: FORM_TYPE  COMPANY  CIK  YYYYMMDD  edgar/data/<cik>/<accession>.txt
const IDX_LINE_RE =
  /^([345](?:\/A)?)\s{2,}(.+?)\s{2,}(\d{1,10})\s{2,}(\d{8})\s{2,}(edgar\/data\/\S+?\.txt)\s*$/;

/** Parse a daily form.idx, keeping only ownership forms in `forms` (base types, e.g. ["4"]). */
export function parseDailyFormIdx(idxText: string, forms: readonly string[]): EdgarFilingRef[] {
  const wanted = new Set(forms.map((f) => f.trim().toUpperCase()));
  const refs: EdgarFilingRef[] = [];

  for (const line of idxText.split("\n")) {
    const m = line.match(IDX_LINE_RE);
    if (!m) continue;
    const [, formType, , cik, ymd, path] = m as unknown as [string, ...string[]];
    if (!wanted.has((formType as string).replace("/A", "").toUpperCase())) continue;

    const accessionMatch = (path as string).match(ACCESSION_RE);
    if (!accessionMatch) continue;

    refs.push({
      accessionNo: accessionMatch[1] as string,
      cik: normalizeCik(cik as string),
      formType: formType as string,
      filedAt: `${(ymd as string).slice(0, 4)}-${(ymd as string).slice(4, 6)}-${(ymd as string).slice(6, 8)}`,
      sourceUrl: `${EDGAR_BASE}/Archives/${path}`,
    });
  }
  return refs;
}

/** Pull the ownershipDocument XML out of a complete submission .txt file. */
export function extractOwnershipXml(fullSubmissionText: string): string | null {
  const start = fullSubmissionText.indexOf("<ownershipDocument");
  const endTag = "</ownershipDocument>";
  const end = fullSubmissionText.lastIndexOf(endTag);
  return start >= 0 && end > start ? fullSubmissionText.slice(start, end + endTag.length) : null;
}

const ACCEPTANCE_RE = /<ACCEPTANCE-DATETIME>\s*(\d{14})/;

/** Offset of a timezone at a given instant, in minutes (e.g. New York in July = -240). */
function tzOffsetMinutes(at: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  const m = (part?.value ?? "").match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * EDGAR acceptance timestamps are US Eastern local time with no offset
 * (e.g. <ACCEPTANCE-DATETIME>20260730170512). Convert to a UTC ISO string.
 */
export function extractAcceptanceDatetime(fullSubmissionText: string): string | null {
  const m = fullSubmissionText.match(ACCEPTANCE_RE);
  if (!m) return null;
  const d = m[1] as string;
  const naiveUtc = Date.UTC(
    Number(d.slice(0, 4)),
    Number(d.slice(4, 6)) - 1,
    Number(d.slice(6, 8)),
    Number(d.slice(8, 10)),
    Number(d.slice(10, 12)),
    Number(d.slice(12, 14)),
  );
  const offset = tzOffsetMinutes(new Date(naiveUtc), "America/New_York");
  return new Date(naiveUtc - offset * 60_000).toISOString();
}
