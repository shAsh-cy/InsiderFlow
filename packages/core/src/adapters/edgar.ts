/**
 * SEC EDGAR — the authoritative US source (primary, filing-based).
 */
import {
  edgarCurrentFeedUrl,
  edgarSubmissionTextUrl,
  extractAcceptanceDatetime,
  extractOwnershipXml,
  parseCurrentFeed,
} from "../edgar";
import type { EdgarFilingRef } from "../edgar";
import { parseOwnershipDocument } from "../form4";
import { isSecTransactionCode } from "../transaction-codes";
import { buildTransaction } from "../unified";
import type {
  MarketMetadata,
  SourceAdapter,
  UnifiedCompany,
  UnifiedFiling,
  UnifiedInsider,
  UnifiedTransaction,
} from "../unified";

export const EDGAR_MARKET: MarketMetadata = {
  market: "US",
  country: "US",
  currency: "USD",
  regulator: "SEC",
  disclosureDeadline: "2 business days (Exchange Act §16a-3)",
  latencyClass: "realtime",
};

export interface EdgarSubmission {
  ref: EdgarFilingRef;
  fullText: string;
}

export interface EdgarRawBatch {
  submissions: EdgarSubmission[];
}

export interface EdgarNormalizedSubmission {
  company: UnifiedCompany;
  insider: UnifiedInsider;
  filing: UnifiedFiling;
  /** Empty for holdings-only filings (most Form 3s) — the filing itself must still be recorded. */
  transactions: UnifiedTransaction[];
}

/**
 * Parse one complete EDGAR submission (.txt) into its normalized entities.
 * Exposed standalone so the ingestion pipeline can diff against the DB
 * between the feed poll and the per-filing fetches. Returns null when the
 * text contains no ownershipDocument.
 */
export function parseEdgarSubmission(
  ref: EdgarFilingRef,
  fullText: string,
): EdgarNormalizedSubmission | null {
  const xml = extractOwnershipXml(fullText);
  if (!xml) return null;
  const doc = parseOwnershipDocument(xml);
  // Multi-owner filings (e.g. a fund + its GP) report one shared transaction
  // set; attach it to the first (primary) owner.
  const owner = doc.owners[0];
  if (!owner) return null;

  const filedAt = extractAcceptanceDatetime(fullText) ?? ref.filedAt;
  const company: UnifiedCompany = {
    externalKey: `cik:${doc.issuer.cik}`,
    cik: doc.issuer.cik,
    name: doc.issuer.name,
    ticker: doc.issuer.ticker,
    country: EDGAR_MARKET.country,
  };
  const insider: UnifiedInsider = {
    externalKey: `cik:${owner.cik}`,
    name: owner.name,
    isDirector: owner.isDirector,
    isOfficer: owner.isOfficer,
    isTenPercentOwner: owner.isTenPercentOwner,
    title: owner.officerTitle,
  };
  const filing: UnifiedFiling = {
    accessionNo: ref.accessionNo,
    formType: ref.formType || doc.formType,
    filedAt,
    sourceUrl: ref.sourceUrl,
    rawXmlUrl: null,
  };

  const transactions: UnifiedTransaction[] = [];
  for (const txn of doc.transactions) {
    if (!isSecTransactionCode(txn.code)) continue;
    const txnDate = txn.transactionDate ?? doc.periodOfReport ?? filedAt?.slice(0, 10);
    if (!txnDate) continue;

    transactions.push(
      buildTransaction({
        source: "edgar",
        market: EDGAR_MARKET.market,
        country: EDGAR_MARKET.country,
        currency: EDGAR_MARKET.currency,
        company,
        insider,
        filing,
        txnDate,
        code: txn.code,
        rawCode: txn.code,
        shares: txn.shares,
        price: txn.pricePerShare,
        value: txn.value,
        acquiredDisposed: txn.acquiredDisposed,
        sharesOwnedAfter: txn.sharesOwnedAfter,
        is10b51: txn.isTenB51,
        isDerivative: txn.isDerivative,
        footnote: txn.footnote,
      }),
    );
  }
  return { company, insider, filing, transactions };
}

/** Adapter-interface normalize: just the transactions of a submission. */
export function normalizeEdgarSubmission(
  ref: EdgarFilingRef,
  fullText: string,
): UnifiedTransaction[] {
  return parseEdgarSubmission(ref, fullText)?.transactions ?? [];
}

export const edgarAdapter = {
  id: "edgar",
  metadata: EDGAR_MARKET,

  async fetch(ctx): Promise<EdgarRawBatch> {
    const headers = ctx.userAgent ? { "User-Agent": ctx.userAgent } : undefined;
    const refs: EdgarFilingRef[] = [];
    for (const form of ["4", "3", "5"]) {
      const response = await ctx.fetchFn(edgarCurrentFeedUrl(form), { headers });
      if (!response.ok) continue;
      refs.push(...parseCurrentFeed(await response.text()));
    }

    const submissions: EdgarSubmission[] = [];
    for (const ref of refs.slice(0, ctx.limit ?? 25)) {
      const response = await ctx.fetchFn(edgarSubmissionTextUrl(ref.cik, ref.accessionNo), {
        headers,
      });
      if (!response.ok) continue;
      submissions.push({ ref, fullText: await response.text() });
    }
    return { submissions };
  },

  normalize(raw: EdgarRawBatch): UnifiedTransaction[] {
    return raw.submissions.flatMap((s) => normalizeEdgarSubmission(s.ref, s.fullText));
  },
} satisfies SourceAdapter<EdgarRawBatch>;
