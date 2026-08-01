/**
 * Parser for SEC ownership documents (Forms 3/4/5) — the `ownershipDocument`
 * XML embedded in every EDGAR ownership filing. Pure and dependency-light so
 * it runs identically in Cloudflare Workers, Node scripts, and tests.
 */
import { XMLParser } from "fast-xml-parser";

import { normalizeCik, normalizeInsiderName, parseFilingNumber } from "./normalize";
import type { SecTransactionCode } from "./transaction-codes";

export interface Form4Issuer {
  /** 10-digit zero-padded CIK. */
  cik: string;
  name: string;
  ticker: string | null;
}

export interface Form4Owner {
  /** 10-digit zero-padded CIK. */
  cik: string;
  /** Normalized via normalizeInsiderName(). */
  name: string;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  officerTitle: string | null;
}

export interface Form4Transaction {
  isDerivative: boolean;
  securityTitle: string | null;
  /** ISO date (YYYY-MM-DD). */
  transactionDate: string | null;
  code: SecTransactionCode | (string & {});
  shares: number | null;
  pricePerShare: number | null;
  /** shares × pricePerShare when both are present, rounded to 4 decimals. */
  value: number | null;
  acquiredDisposed: "A" | "D" | null;
  sharesOwnedAfter: number | null;
  /** "D" = direct ownership, "I" = indirect. */
  ownershipForm: "D" | "I" | null;
  /** Concatenated text of the footnotes this transaction references. */
  footnote: string | null;
  /** Covered by a Rule 10b5-1 plan (filing checkbox or footnote language). */
  isTenB51: boolean;
}

export interface ParsedOwnershipDocument {
  /** "3" | "4" | "5" (amendments keep their base type here; see filings.form_type for the raw type). */
  formType: string;
  periodOfReport: string | null;
  /** For amendments (4/A...): the date the original filing was submitted. */
  originalSubmissionDate: string | null;
  /** The filing-level "made pursuant to a Rule 10b5-1 plan" checkbox. */
  affTenB51: boolean;
  issuer: Form4Issuer;
  /** A filing can have multiple reporting owners (e.g. a fund and its GP). */
  owners: Form4Owner[];
  /** Table I (non-derivative) then Table II (derivative). Holdings-only rows are excluded. */
  transactions: Form4Transaction[];
  footnotes: Record<string, string>;
}

const ARRAY_TAGS = new Set([
  "reportingOwner",
  "nonDerivativeTransaction",
  "derivativeTransaction",
  "nonDerivativeHolding",
  "derivativeHolding",
  "footnote",
  "footnoteId",
]);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Keep everything as strings: CIKs must not lose leading zeros.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
});

const TENB51_RE = /10b5-1/i;

type XmlNode = Record<string, unknown>;

function obj(v: unknown): XmlNode {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as XmlNode) : {};
}

function arr(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  return v === undefined || v === null ? [] : [v];
}

function text(v: unknown): string | null {
  if (typeof v === "string") return v.length > 0 ? v : null;
  if (typeof v === "object" && v !== null) {
    const t = (v as XmlNode)["#text"];
    if (typeof t === "string" && t.length > 0) return t;
  }
  return null;
}

/** EDGAR wraps most scalars as <foo><value>x</value></foo>; some are bare. */
function valueOf(node: unknown): string | null {
  return text(obj(node).value) ?? text(node);
}

function flag(node: unknown): boolean {
  const v = valueOf(node);
  return v === "1" || v?.toLowerCase() === "true";
}

function dateOf(node: unknown): string | null {
  const v = valueOf(node);
  // Occasionally dates carry a timezone suffix ("2026-07-30-04:00").
  return v && v.length >= 10 ? v.slice(0, 10) : null;
}

function cleanTicker(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim().toUpperCase();
  return t === "" || t === "NONE" || t === "N/A" || t === "NA" ? null : t;
}

/** Recursively collect <footnoteId id="F1"/> references in a transaction subtree. */
function collectFootnoteIds(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectFootnoteIds(item, into);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  for (const [key, val] of Object.entries(node)) {
    if (key === "footnoteId") {
      for (const ref of arr(val)) {
        const id = obj(ref)["@_id"];
        if (typeof id === "string" && id.length > 0) into.add(id);
      }
    } else if (!key.startsWith("@_")) {
      collectFootnoteIds(val, into);
    }
  }
}

function parseOwner(node: unknown): Form4Owner {
  const owner = obj(node);
  const id = obj(owner.reportingOwnerId);
  const rel = obj(owner.reportingOwnerRelationship);
  return {
    cik: normalizeCik(valueOf(id.rptOwnerCik) ?? ""),
    name: normalizeInsiderName(valueOf(id.rptOwnerName) ?? ""),
    isDirector: flag(rel.isDirector),
    isOfficer: flag(rel.isOfficer),
    isTenPercentOwner: flag(rel.isTenPercentOwner),
    officerTitle: valueOf(rel.officerTitle),
  };
}

function parseTransaction(
  node: unknown,
  isDerivative: boolean,
  footnotes: Record<string, string>,
  affTenB51: boolean,
): Form4Transaction {
  const t = obj(node);
  const coding = obj(t.transactionCoding);
  const amounts = obj(t.transactionAmounts);
  const post = obj(t.postTransactionAmounts);
  const nature = obj(t.ownershipNature);

  const ids = new Set<string>();
  collectFootnoteIds(t, ids);
  const footnote =
    [...ids]
      .sort()
      .map((id) => footnotes[id])
      .filter(Boolean)
      .join(" ") || null;

  const shares = parseFilingNumber(valueOf(amounts.transactionShares));
  const pricePerShare = parseFilingNumber(valueOf(amounts.transactionPricePerShare));
  const value =
    shares !== null && pricePerShare !== null
      ? Math.round(shares * pricePerShare * 10_000) / 10_000
      : null;

  const ad = valueOf(amounts.transactionAcquiredDisposedCode);
  const own = valueOf(nature.directOrIndirectOwnership);

  return {
    isDerivative,
    securityTitle: valueOf(t.securityTitle),
    transactionDate: dateOf(t.transactionDate),
    code: (valueOf(coding.transactionCode) ?? "").toUpperCase(),
    shares,
    pricePerShare,
    value,
    acquiredDisposed: ad === "A" || ad === "D" ? ad : null,
    sharesOwnedAfter: parseFilingNumber(valueOf(post.sharesOwnedFollowingTransaction)),
    ownershipForm: own === "D" || own === "I" ? own : null,
    footnote,
    isTenB51: affTenB51 || (footnote !== null && TENB51_RE.test(footnote)),
  };
}

/**
 * Parse an `ownershipDocument` XML string (Form 3/4/5) into normalized data.
 * Throws when the input is not an ownership document.
 */
export function parseOwnershipDocument(xml: string): ParsedOwnershipDocument {
  const root = obj(obj(xmlParser.parse(xml)).ownershipDocument);
  if (Object.keys(root).length === 0) {
    throw new Error("Not an ownershipDocument XML");
  }

  const issuerNode = obj(root.issuer);
  const issuer: Form4Issuer = {
    cik: normalizeCik(valueOf(issuerNode.issuerCik) ?? ""),
    name: valueOf(issuerNode.issuerName) ?? "",
    ticker: cleanTicker(valueOf(issuerNode.issuerTradingSymbol)),
  };

  const footnotes: Record<string, string> = {};
  for (const f of arr(obj(root.footnotes).footnote)) {
    const id = obj(f)["@_id"];
    const body = text(f);
    if (typeof id === "string" && id.length > 0 && body) footnotes[id] = body;
  }

  const affTenB51 = flag(root.aff10b5One);

  const transactions: Form4Transaction[] = [];
  for (const t of arr(obj(root.nonDerivativeTable).nonDerivativeTransaction)) {
    transactions.push(parseTransaction(t, false, footnotes, affTenB51));
  }
  for (const t of arr(obj(root.derivativeTable).derivativeTransaction)) {
    transactions.push(parseTransaction(t, true, footnotes, affTenB51));
  }

  return {
    formType: valueOf(root.documentType) ?? "4",
    periodOfReport: dateOf(root.periodOfReport),
    originalSubmissionDate: dateOf(root.dateOfOriginalSubmission),
    affTenB51,
    issuer,
    owners: arr(root.reportingOwner).map(parseOwner),
    transactions,
    footnotes,
  };
}
