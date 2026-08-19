/**
 * Parsers and mappers for the OPTIONAL India local-scrape provider
 * (ingestion/india-local). Everything here is pure — session/cookie
 * mechanics live in the runner. See that module's README for the legal
 * posture: the hosted deployment does not run any of this.
 *
 * Field-name provenance — every NSE shape here is now recorded, not
 * inferred:
 *  - BSE announcement + scrip-search: live 2026-08-02.
 *  - NSE SAST, bulk deals, pledges: live 2026-08-18, residential Indian
 *    line (1,334 / 70 / 1,693 rows).
 *  - NSE PIT: live 2026-08-19, via `corporates-pit-gg` and the XBRL
 *    documents it links (169 filings over seven days).
 *
 * The earlier note here said NSE "soft-fails to empty JSON for non-browser
 * clients, so the exact keys could not be re-recorded". That was wrong
 * about PIT specifically, and wrong for three rounds: `corporates-pit` is
 * RETIRED and answers an empty envelope to everyone, from any address.
 * See `nsePitUrl` below.
 */
import { parseFilingNumber } from "../normalize";
import type { IndiaDisclosureRecord } from "./india";
import { parseIndianDate } from "./india";

// ── Endpoints ────────────────────────────────────────────────────────────────

export const NSE_BASE = "https://www.nseindia.com";
/**
 * Priming target. Verified live: the NSE homepage returns 403 to non-browser
 * clients, but this listing page returns 200 and sets the session cookies.
 */
export const NSE_PRIME_URL = `${NSE_BASE}/companies-listing/corporate-filings-insider-trading`;
export const NSE_PIT_REFERER = NSE_PRIME_URL;

const ddmmyyyy = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
};

/**
 * SEBI PIT disclosures — RETIRED. Kept only so the reason is discoverable
 * from the name someone will search for.
 *
 * This endpoint still answers `HTTP 200` with `{"acqNameList":[],"data":[]}`
 * and has returned zero rows for every window tried, including ninety days
 * from a residential Indian line. It is not a block and never was: NSE
 * moved PIT to an XBRL-backed filing index at `corporates-pit-gg` (the
 * documents carry `<!--PIT V2.0 (30-04-2026)-->`), and the retired path
 * was left answering an empty envelope instead of a 404.
 *
 * A dead endpoint that returns 200 and no data is the worst available
 * failure shape — it looks exactly like a quiet week — and this one was
 * read as an IP block for three rounds. Use {@link nsePitIndexUrl}.
 *
 * @deprecated superseded by `nsePitIndexUrl`; returns an empty envelope.
 */
export function nsePitUrl(fromIso: string, toIso: string): string {
  return `${NSE_BASE}/api/corporates-pit?index=equities&from_date=${ddmmyyyy(fromIso)}&to_date=${ddmmyyyy(toIso)}`;
}

/**
 * SEBI PIT filing index (live). Dates are DD-MM-YYYY.
 *
 * The name is not a guess: NSE's own insider-trading page declares it in
 * an inline script — `activeApiName = "corporates-pit-gg"` — alongside
 * `innerActiveTab = "equities"`, which is where the `index` value comes
 * from too.
 *
 * Each row is a FILING, not a trade. The trades are in the XBRL document
 * the row links to, which is the same two-step EDGAR uses: index first,
 * then parse the document. See {@link parsePitXbrl}.
 */
export function nsePitIndexUrl(fromIso: string, toIso: string): string {
  return `${NSE_BASE}/api/corporates-pit-gg?index=equities&from_date=${ddmmyyyy(fromIso)}&to_date=${ddmmyyyy(toIso)}`;
}

/** SAST (Reg. 29/31) disclosures. */
export function nseSastUrl(fromIso: string, toIso: string): string {
  return `${NSE_BASE}/api/corporate-sast-reg29?index=equities&from_date=${ddmmyyyy(fromIso)}&to_date=${ddmmyyyy(toIso)}`;
}

/** Promoter pledge disclosures (SAST Reg. 31 pledge annexure). */
export function nsePledgeUrl(fromIso: string, toIso: string): string {
  return `${NSE_BASE}/api/corporate-pledgedata?index=equities&from_date=${ddmmyyyy(fromIso)}&to_date=${ddmmyyyy(toIso)}`;
}

/** Bulk or block deals. */
export function nseBulkBlockUrl(
  kind: "bulk_deals" | "block_deals",
  fromIso: string,
  toIso: string,
): string {
  return `${NSE_BASE}/api/historicalOR/bulk-block-short-deals?optionType=${kind}&from=${ddmmyyyy(fromIso)}&to=${ddmmyyyy(toIso)}`;
}

export const BSE_BASE = "https://api.bseindia.com";
export const BSE_REFERER = "https://www.bseindia.com/";
export const BSE_ORIGIN = "https://www.bseindia.com";

/**
 * Corporate announcements (metadata + PDF attachment links — verified live:
 * this endpoint does NOT carry structured trade numbers). Dates YYYYMMDD;
 * empty dates mean "today".
 */
export function bseAnnouncementsUrl(
  opts: { fromYmd?: string; toYmd?: string; page?: number } = {},
): string {
  const { fromYmd = "", toYmd = "", page = 1 } = opts;
  return `${BSE_BASE}/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=${page}&strCat=-1&strPrevDate=${fromYmd}&strScrip=&strSearch=P&strToDate=${toYmd}&strType=C&subcategory=-1`;
}

/** Scrip-code / ISIN resolution (HTML fragment response, verified live). */
export function bseScripSearchUrl(text: string): string {
  return `${BSE_BASE}/Msource/1D/getqouteSearch.aspx?Type=EQ&text=${encodeURIComponent(text)}&flag=site`;
}

// ── NSE PIT → IndiaDisclosureRecord (the existing feed contract) ────────────

/** Raw NSE corporates-pit row (public shape; re-verify with --smoke before first live run). */
export interface NsePitRawRow {
  symbol?: string | null;
  company?: string | null;
  acqName?: string | null;
  personCategory?: string | null;
  secType?: string | null;
  secAcq?: string | number | null;
  secVal?: string | number | null;
  acqMode?: string | null;
  tdpTransactionType?: string | null;
  acqfromDt?: string | null;
  acqtoDt?: string | null;
  intimDt?: string | null;
  befAcqSharesNo?: string | number | null;
  afterAcqSharesNo?: string | number | null;
  xbrl?: string | null;
}

/**
 * Map a raw NSE PIT row into the operator-feed contract — the exact record
 * shape an INDIA_FEED_URL feed provides, so indiaAdapter.normalize() and the
 * whole UnifiedTransaction path work unchanged.
 */
export function mapNsePitToDisclosure(raw: NsePitRawRow): IndiaDisclosureRecord | null {
  const symbol = raw.symbol?.trim();
  const name = raw.acqName?.trim();
  const date = raw.acqtoDt ?? raw.acqfromDt ?? raw.intimDt;
  if (!symbol || !name || !parseIndianDate(date)) return null;
  return {
    symbol,
    company: raw.company ?? null,
    acquirerName: name,
    personCategory: raw.personCategory ?? null,
    securityType: raw.secType ?? null,
    quantity: raw.secAcq ?? null,
    value: raw.secVal ?? null,
    mode: raw.acqMode ?? null,
    transactionType: raw.tdpTransactionType ?? null,
    date,
    exchange: "NSE",
  };
}

// ── NSE PIT V2: filing index + XBRL document ────────────────────────────────

/**
 * A row of `corporates-pit-gg` — VERIFIED LIVE 2026-08-19 (169 rows over
 * seven days, 353 over thirty).
 *
 * Every field below was read off a real payload; none is inferred. The row
 * describes a SUBMISSION and carries no trade numbers at all — those are in
 * the linked document.
 */
export interface NsePitIndexRow {
  symbol?: string | null;
  companyName?: string | null;
  /** "Regulation 7 (2)" | "Regulation 7 (3)". */
  regulation?: string | null;
  /** "Original" | "Revision". */
  typeOfSubmission?: string | null;
  /** Submission id; `prevAppId` chains a revision to what it replaces. */
  appId?: string | null;
  prevAppId?: string | null;
  revisionRemark?: string | null;
  /** "00:00:00" — NSE's own broadcast-vs-dissemination lag on this filing. */
  diff?: string | null;
  /** "18-Aug-2026 20:38:34". */
  broadcastDateTime?: string | null;
  exchdisstime?: string | null;
  /** Absolute nsearchives URLs. The XML is the machine-readable one. */
  xmlFileName?: string | null;
  ixbrl?: string | null;
  xbrlFileSize?: string | null;
  ixbrlFileSize?: string | null;
}

/** Filing-level facts — the `MainI` context of a PIT XBRL document. */
export interface PitXbrlFiling {
  symbol: string | null;
  companyName: string | null;
  isin: string | null;
  scripCode: string | null;
  regulation: string | null;
  dateOfFiling: string | null;
  /** `RevisedFilling` — NSE's spelling, kept so a grep against the source matches. */
  revised: boolean;
}

/**
 * One transaction — a `DisclosureN` context.
 *
 * Percentages are carried AS FILED. In the sample recorded here a holding
 * of 1,105,770 shares reports `0.0383`, which reads as a fraction rather
 * than a percent; SAST's equivalent fields are whole percents. Rather than
 * multiply by a hundred on a hunch, the filed value is passed through and
 * the ambiguity is named. Deciding it would need a shares-outstanding
 * figure this document does not contain.
 */
export interface PitXbrlDisclosure {
  instrument: string | null;
  personCategory: string | null;
  personName: string | null;
  /** DIN for a director, CIN for a company. */
  identificationNumber: string | null;
  sharesBefore: number | null;
  pctBeforeAsFiled: number | null;
  shares: number | null;
  /** INR. */
  value: number | null;
  /** "Buy" | "Sell". */
  transactionType: string | null;
  sharesAfter: number | null;
  pctAfterAsFiled: number | null;
  fromDate: string | null;
  toDate: string | null;
  mode: string | null;
  intimationDate: string | null;
  /** Per TRANSACTION, not per filing — one document can span both venues. */
  exchange: string | null;
}

export interface ParsedPitXbrl {
  filing: PitXbrlFiling;
  disclosures: PitXbrlDisclosure[];
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const decodeXml = (s: string): string =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => XML_ENTITIES[name] ?? _);

/**
 * Facts from a PIT XBRL instance, grouped by context.
 *
 * Deliberately a regex and not an XML parser. The instance is flat — one
 * level of `<in-bse-co:Name contextRef="...">value</in-bse-co:Name>` — and
 * adding a parser dependency to `packages/core` would put it in the
 * Cloudflare Worker bundle, which never touches India at all.
 *
 * The taxonomy is BSE's (`in-bse-co`) even on NSE: both exchanges consume
 * the same SEBI PIT schema, which is why one parser serves both.
 */
function factsByContext(xml: string): Map<string, Map<string, string>> {
  const contexts = new Map<string, Map<string, string>>();
  for (const match of xml.matchAll(
    /<in-bse-co:([A-Za-z0-9_]+)\b([^>]*)>([\s\S]*?)<\/in-bse-co:\1>/g,
  )) {
    const [, name, attrs, raw] = match;
    const context = /contextRef="([^"]+)"/.exec(attrs ?? "")?.[1];
    // No contextRef means a domain member, not a reported fact.
    if (!context || !name) continue;
    const bucket = contexts.get(context) ?? new Map<string, string>();
    bucket.set(name, decodeXml((raw ?? "").trim()));
    contexts.set(context, bucket);
  }
  return contexts;
}

const text = (bucket: Map<string, string> | undefined, key: string): string | null => {
  const value = bucket?.get(key)?.trim();
  return value ? value : null;
};

const number = (bucket: Map<string, string> | undefined, key: string): number | null =>
  parseFilingNumber(text(bucket, key));

/**
 * Parse a PIT XBRL instance into its filing and its transactions.
 *
 * One document can carry SEVERAL transactions — the sample recorded for the
 * tests has two, executed the same day on different exchanges — so this
 * returns a list. Treating a document as one trade would have silently
 * halved the tape.
 */
export function parsePitXbrl(xml: string): ParsedPitXbrl {
  const contexts = factsByContext(xml);
  const main = contexts.get("MainI");

  const filing: PitXbrlFiling = {
    symbol: text(main, "Symbol"),
    companyName: text(main, "NameOfTheCompany"),
    isin: text(main, "ISINCode"),
    scripCode: text(main, "ScripCode"),
    regulation: text(main, "DisclosureUnderRegulation"),
    dateOfFiling: text(main, "DateOfFiling"),
    revised: text(main, "RevisedFilling")?.toLowerCase() === "true",
  };

  const disclosures: PitXbrlDisclosure[] = [];
  // Numeric order, so Disclosure10 does not sort before Disclosure2 and
  // change the order rows are written in.
  const keys = [...contexts.keys()]
    .filter((k) => /^Disclosure\d+$/.test(k))
    .sort((a, b) => Number(a.slice(10)) - Number(b.slice(10)));

  for (const key of keys) {
    const c = contexts.get(key);
    disclosures.push({
      instrument: text(c, "TypeOfInstrument"),
      personCategory: text(c, "CategoryOfPerson"),
      personName: text(c, "NameOfThePerson"),
      identificationNumber: text(c, "IdentificationNumberOfDirectorOrCompany"),
      sharesBefore: number(c, "SecuritiesHeldPriorToAcquisitionOrDisposalNumberOfSecurity"),
      pctBeforeAsFiled: number(
        c,
        "SecuritiesHeldPriorToAcquisitionOrDisposalPercentageOfShareholding",
      ),
      shares: number(c, "SecuritiesAcquiredOrDisposedNumberOfSecurity"),
      value: number(c, "SecuritiesAcquiredOrDisposedValueOfSecurity"),
      transactionType: text(c, "SecuritiesAcquiredOrDisposedTransactionType"),
      // NSE's taxonomy spells it "Acquistion". Reproduced exactly; a
      // corrected spelling here reads every one of these as null.
      sharesAfter: number(c, "SecuritiesHeldPostAcquistionOrDisposalNumberOfSecurity"),
      pctAfterAsFiled: number(c, "SecuritiesHeldPostAcquistionOrDisposalPercentageOfShareholding"),
      fromDate: text(c, "DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyFromDate"),
      toDate: text(c, "DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyToDate"),
      mode: text(c, "ModeOfAcquisitionOrDisposal"),
      intimationDate: text(c, "DateOfIntimationToCompany"),
      exchange: text(c, "ExchangeOnWhichTheTradeWasExecuted"),
    });
  }

  return { filing, disclosures };
}

/**
 * A parsed PIT document, as the operator-feed contract.
 *
 * Same output shape as the retired JSON path, so `indiaAdapter.normalize()`
 * and the whole UnifiedTransaction route are unchanged — the endpoint moved,
 * the contract did not.
 *
 * `index` supplies the symbol when the document omits it, which happens on
 * filings from companies not listed on NSE under the same ticker.
 */
export function mapPitXbrlToDisclosures(
  parsed: ParsedPitXbrl,
  index: Pick<NsePitIndexRow, "symbol" | "companyName"> = {},
): IndiaDisclosureRecord[] {
  const symbol = parsed.filing.symbol ?? index.symbol?.trim() ?? null;
  if (!symbol) return [];
  const company = parsed.filing.companyName ?? index.companyName ?? null;

  return parsed.disclosures.flatMap((d) => {
    const name = d.personName?.trim();
    // Transaction dates first: `toDate` is when it completed. Intimation is
    // the fallback, never the preference — it is when the company was told.
    const date = d.toDate ?? d.fromDate ?? d.intimationDate ?? null;
    if (!name || !parseIndianDate(date)) return [];
    return [
      {
        symbol,
        company,
        acquirerName: name,
        personCategory: d.personCategory,
        securityType: d.instrument,
        quantity: d.shares,
        value: d.value,
        mode: d.mode,
        transactionType: d.transactionType,
        date,
        exchange: d.exchange ?? "NSE",
      },
    ];
  });
}

// ── NSE SAST / pledge / bulk-block → new-table structs ──────────────────────

const num = (v: string | number | null | undefined): number | null =>
  typeof v === "number" ? (Number.isFinite(v) ? v : null) : parseFilingNumber(v ?? null);

/**
 * Raw NSE `corporate-sast-reg29` row — field names VERIFIED LIVE 2026-08-02
 * (45 rows). This endpoint carries no monetary value, and the percentages
 * are diluted-basis (`totAftDiluted` = holding % after). A couple of legacy
 * aliases are kept optional for resilience.
 */
export interface NseSastRawRow {
  symbol?: string | null;
  company?: string | null;
  acquirerName?: string | null;
  /** "29(1)" | "29(2)" | "31(1)" ... */
  regType?: string | null;
  /** Promoter / Public / ... */
  promoterType?: string | null;
  acquisitionMode?: string | null;
  /** "Acquisition" | "Sale" / "Buy" | "Sell". */
  acqSaleType?: string | null;
  acqType?: string | null;
  noOfShareAcq?: string | number | null;
  noOfShareSale?: string | number | null;
  totAcqShare?: string | number | null;
  totSaleShare?: string | number | null;
  /** Holding % after the transaction (diluted basis). */
  totAftDiluted?: string | number | null;
  totAcqDiluted?: string | number | null;
  /** Transaction date; NSE also returns `timestamp` (filing time). */
  acquirerDate?: string | null;
  timestamp?: string | null;
  intimDt?: string | null;
  attachement?: string | null;
}

export interface SastRecord {
  symbol: string;
  companyName: string;
  acquirerName: string;
  regulation: string | null;
  category: string | null;
  acquisitionMode: string | null;
  side: "acquisition" | "disposal" | null;
  shares: number | null;
  sharesPctBefore: number | null;
  sharesPctAfter: number | null;
  /** INR. */
  value: number | null;
  txnDate: string | null;
  intimatedAt: string | null;
  sourceUrl: string | null;
  /** Identity WITHOUT occurrence suffix; runner applies assignOccurrenceKeys. */
  identity: string;
}

export function normalizeSastRows(rows: readonly NseSastRawRow[]): SastRecord[] {
  const out: SastRecord[] = [];
  for (const raw of rows) {
    const symbol = raw.symbol?.trim().toUpperCase();
    const acquirer = raw.acquirerName?.trim();
    if (!symbol || !acquirer) continue;

    const acquired = num(raw.noOfShareAcq ?? raw.totAcqShare);
    const sold = num(raw.noOfShareSale ?? raw.totSaleShare);
    const txnType = `${raw.acqSaleType ?? ""} ${raw.acqType ?? ""}`.toLowerCase();
    const side: SastRecord["side"] =
      txnType.includes("disp") ||
      txnType.includes("sale") ||
      txnType.includes("sell") ||
      (sold !== null && sold > 0)
        ? "disposal"
        : txnType.includes("acq") || txnType.includes("buy") || (acquired !== null && acquired > 0)
          ? "acquisition"
          : null;
    const shares = side === "disposal" ? (sold ?? acquired) : (acquired ?? sold);
    // This endpoint returns the transaction date but no monetary value.
    const txnDate = parseIndianDate(raw.acquirerDate ?? raw.timestamp);
    out.push({
      symbol,
      companyName: raw.company?.trim() || symbol,
      acquirerName: acquirer,
      regulation: raw.regType?.trim() || null,
      category: raw.promoterType?.trim() || null,
      acquisitionMode: raw.acquisitionMode?.trim() || null,
      side,
      shares,
      // No clean "before %" in the feed; % after is the diluted holding.
      sharesPctBefore: null,
      sharesPctAfter: num(raw.totAftDiluted),
      value: null,
      txnDate,
      intimatedAt: parseIndianDate(raw.intimDt),
      sourceUrl: raw.attachement ?? null,
      identity: ["IN", "SAST", symbol, acquirer.toUpperCase(), txnDate ?? "?", shares ?? "?"].join(
        "|",
      ),
    });
  }
  return out;
}

export interface NseBulkBlockRawRow {
  BD_DT_DATE?: string | null;
  BD_SYMBOL?: string | null;
  BD_SCRIP_NAME?: string | null;
  BD_CLIENT_NAME?: string | null;
  BD_BUY_SELL?: string | null; // "BUY" | "SELL"
  BD_QTY_TRD?: string | number | null;
  BD_TP_WATP?: string | number | null; // weighted average trade price
  BD_REMARKS?: string | null;
}

export interface BulkBlockRecord {
  dealType: "bulk" | "block";
  dealDate: string;
  symbol: string;
  companyName: string | null;
  clientName: string;
  side: "buy" | "sell";
  quantity: number;
  wap: number | null;
  /** INR = quantity × wap when priced. */
  value: number | null;
  remarks: string | null;
  identity: string;
}

export function normalizeBulkBlockRows(
  rows: readonly NseBulkBlockRawRow[],
  dealType: "bulk" | "block",
): BulkBlockRecord[] {
  const out: BulkBlockRecord[] = [];
  for (const raw of rows) {
    const symbol = raw.BD_SYMBOL?.trim().toUpperCase();
    const client = raw.BD_CLIENT_NAME?.trim();
    const dealDate = parseIndianDate(raw.BD_DT_DATE);
    const quantity = num(raw.BD_QTY_TRD);
    const sideRaw = raw.BD_BUY_SELL?.trim().toLowerCase();
    if (!symbol || !client || !dealDate || quantity === null || quantity <= 0) continue;
    if (sideRaw !== "buy" && sideRaw !== "sell") continue;
    const wap = num(raw.BD_TP_WATP);
    out.push({
      dealType,
      dealDate,
      symbol,
      companyName: raw.BD_SCRIP_NAME?.trim() || null,
      clientName: client,
      side: sideRaw,
      quantity,
      wap,
      value: wap !== null ? Math.round(quantity * wap * 10_000) / 10_000 : null,
      remarks: raw.BD_REMARKS?.trim() || null,
      identity: [
        "IN",
        dealType.toUpperCase(),
        symbol,
        client.toUpperCase(),
        dealDate,
        quantity,
        sideRaw,
      ].join("|"),
    });
  }
  return out;
}

export interface NsePledgeRawRow {
  symbol?: string | null;
  company?: string | null;
  promoterName?: string | null;
  pledgorName?: string | null;
  eventType?: string | null; // "Pledge" | "Revoke" | "Invocation" ...
  purpose?: string | null;
  noOfShares?: string | number | null;
  perOfShares?: string | number | null;
  eventDate?: string | null;
  date?: string | null;
  intimDt?: string | null;
  xbrl?: string | null;
}

export interface PledgeRecord {
  symbol: string;
  companyName: string | null;
  promoterName: string;
  eventType: "pledge" | "revoke" | "invoke" | null;
  shares: number | null;
  sharesPct: number | null;
  eventDate: string | null;
  intimatedAt: string | null;
  sourceUrl: string | null;
  identity: string;
}

export function normalizePledgeRows(rows: readonly NsePledgeRawRow[]): PledgeRecord[] {
  const out: PledgeRecord[] = [];
  for (const raw of rows) {
    const symbol = raw.symbol?.trim().toUpperCase();
    const promoter = (raw.promoterName ?? raw.pledgorName)?.trim();
    if (!symbol || !promoter) continue;
    const eventRaw = (raw.eventType ?? "").toLowerCase();
    const eventType: PledgeRecord["eventType"] = eventRaw.includes("invo")
      ? "invoke"
      : eventRaw.includes("rev") || eventRaw.includes("release")
        ? "revoke"
        : eventRaw.includes("pledge") || eventRaw.includes("creat")
          ? "pledge"
          : null;
    const eventDate = parseIndianDate(raw.eventDate ?? raw.date);
    const shares = num(raw.noOfShares);
    out.push({
      symbol,
      companyName: raw.company?.trim() || null,
      promoterName: promoter,
      eventType,
      shares,
      sharesPct: num(raw.perOfShares),
      eventDate,
      intimatedAt: parseIndianDate(raw.intimDt),
      sourceUrl: raw.xbrl ?? null,
      identity: [
        "IN",
        "PLEDGE",
        symbol,
        promoter.toUpperCase(),
        eventDate ?? "?",
        eventType ?? "?",
        shares ?? "?",
      ].join("|"),
    });
  }
  return out;
}

// ── BSE (shapes recorded live 2026-08-02) ───────────────────────────────────

export interface BseAnnouncementRow {
  SCRIP_CD?: number | string | null;
  SLONGNAME?: string | null;
  NEWSSUB?: string | null;
  HEADLINE?: string | null;
  CATEGORYNAME?: string | null;
  SUBCATNAME?: string | null;
  NEWS_DT?: string | null;
  ATTACHMENTNAME?: string | null;
  NSURL?: string | null;
}

export interface BseInsiderAnnouncement {
  scripCode: string;
  company: string;
  headline: string;
  category: string;
  subCategory: string;
  newsDate: string | null;
  attachmentUrl: string | null;
  nsUrl: string | null;
}

const BSE_INSIDER_RE = /insider|sast|pledge|substantial acquisition|takeover/i;

/**
 * Keep only insider/SAST/pledge announcements. These carry metadata + a PDF
 * attachment (no structured numbers) — used as an independent cross-check
 * against NSE coverage, and as a discovery trail for missing filings.
 */
export function filterBseInsiderAnnouncements(
  rows: readonly BseAnnouncementRow[],
): BseInsiderAnnouncement[] {
  const out: BseInsiderAnnouncement[] = [];
  for (const row of rows) {
    const haystack = `${row.CATEGORYNAME ?? ""} ${row.SUBCATNAME ?? ""} ${row.NEWSSUB ?? ""}`;
    if (!BSE_INSIDER_RE.test(haystack)) continue;
    const scripCode = row.SCRIP_CD != null ? String(row.SCRIP_CD) : "";
    if (!scripCode) continue;
    out.push({
      scripCode,
      company: row.SLONGNAME?.trim() ?? "",
      headline: (row.HEADLINE ?? row.NEWSSUB ?? "").trim(),
      category: row.CATEGORYNAME?.trim() ?? "",
      subCategory: row.SUBCATNAME?.trim() ?? "",
      newsDate: row.NEWS_DT ? row.NEWS_DT.slice(0, 10) : null,
      attachmentUrl: row.ATTACHMENTNAME
        ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${row.ATTACHMENTNAME}`
        : null,
      nsUrl: row.NSURL?.trim() || null,
    });
  }
  return out;
}

export interface BseScripMatch {
  scripCode: string;
  isin: string | null;
  name: string;
}

const BSE_SEARCH_LI_RE = /href='\/stock-share-price\/[^/]+\/[^/]+\/(\d+)\/'[^>]*>([\s\S]*?)<\/a>/gi;
const BSE_ISIN_RE = /\b(IN[A-Z0-9]{10})\b/;

/** Parse BSE's scrip-search HTML fragment (shape recorded live 2026-08-02). */
export function parseBseScripSearch(html: string): BseScripMatch[] {
  const out: BseScripMatch[] = [];
  for (const match of html.matchAll(BSE_SEARCH_LI_RE)) {
    const inner = (match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
    out.push({
      scripCode: match[1] as string,
      isin: inner.match(BSE_ISIN_RE)?.[1] ?? null,
      name: inner.replace(BSE_ISIN_RE, "").replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}
