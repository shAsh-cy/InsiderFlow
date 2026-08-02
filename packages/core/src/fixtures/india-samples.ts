/**
 * Recorded fixtures for the India local-scrape provider tests.
 *
 * BSE rows: field names recorded from a live AnnSubCategoryGetData /
 * getqouteSearch probe on 2026-08-02 (values partly anonymized; one
 * insider-category row synthesized with the same field names).
 * NSE rows: constructed to the public corporates-API shapes; re-verify with
 * `pnpm india:ingest --smoke` from a residential connection.
 */
import type {
  BseAnnouncementRow,
  NseBulkBlockRawRow,
  NsePitRawRow,
  NsePledgeRawRow,
  NseSastRawRow,
} from "../adapters/india-scrape";

export const SAMPLE_NSE_PIT_ROWS: NsePitRawRow[] = [
  {
    symbol: "RELIANCE",
    company: "Reliance Industries Limited",
    acqName: "Kumar Rajesh",
    personCategory: "Promoters",
    secType: "Equity Shares",
    secAcq: "1,00,000",
    secVal: "24,50,00,000",
    acqMode: "Market Purchase",
    tdpTransactionType: "Buy",
    acqfromDt: "29-JUL-2026",
    acqtoDt: "30-JUL-2026",
    intimDt: "31-JUL-2026",
    befAcqSharesNo: "5,00,000",
    afterAcqSharesNo: "6,00,000",
    xbrl: "https://nsearchives.nseindia.com/corporate/xbrl/PIT_sample.xml",
  },
  {
    symbol: "INFY",
    company: "Infosys Limited",
    acqName: "Sharma Priya",
    personCategory: "Director",
    secType: "Equity Shares",
    secAcq: "5,000",
    secVal: "72,50,000",
    acqMode: "Market Sale",
    tdpTransactionType: "Sell",
    acqfromDt: "30-JUL-2026",
    acqtoDt: "30-JUL-2026",
    intimDt: "31-JUL-2026",
    befAcqSharesNo: "25,000",
    afterAcqSharesNo: "20,000",
    xbrl: null,
  },
  // Malformed row: no acquirer name → must be dropped, not crash.
  { symbol: "JUNK", company: "Junk Ltd", acqName: "", acqtoDt: "30-JUL-2026" },
];

// Field names as returned live by NSE corporate-sast-reg29 (verified 2026-08-02).
export const SAMPLE_NSE_SAST_ROWS: NseSastRawRow[] = [
  {
    symbol: "TATAMOTORS",
    company: "Tata Motors Limited",
    acquirerName: "Horizon Growth Fund LP",
    regType: "29(2)",
    promoterType: "Public",
    acquisitionMode: "Open Market / Market Purchase",
    acqSaleType: "Acquisition",
    noOfShareAcq: "35,00,000",
    noOfShareSale: null,
    totAcqDiluted: "1.06",
    totAftDiluted: "5.91",
    acquirerDate: "30-JUL-2026",
    intimDt: "31-JUL-2026",
    attachement: "https://nsearchives.nseindia.com/corporate/SAST_sample.pdf",
  },
  {
    symbol: "WIPRO",
    company: "Wipro Limited",
    acquirerName: "Legacy Trust",
    regType: "29(2)",
    promoterType: "Promoter Group",
    acqSaleType: "Sale",
    noOfShareAcq: null,
    noOfShareSale: "12,00,000",
    totAftDiluted: "5.2",
    acquirerDate: "29-JUL-2026",
    intimDt: "30-JUL-2026",
  },
];

export const SAMPLE_NSE_BULK_ROWS: NseBulkBlockRawRow[] = [
  {
    BD_DT_DATE: "31-JUL-2026",
    BD_SYMBOL: "IDEA",
    BD_SCRIP_NAME: "Vodafone Idea Limited",
    BD_CLIENT_NAME: "QUANT ALPHA LLP",
    BD_BUY_SELL: "BUY",
    BD_QTY_TRD: "2,50,00,000",
    BD_TP_WATP: "14.85",
    BD_REMARKS: null,
  },
  {
    BD_DT_DATE: "31-JUL-2026",
    BD_SYMBOL: "IDEA",
    BD_SCRIP_NAME: "Vodafone Idea Limited",
    BD_CLIENT_NAME: "QUANT ALPHA LLP",
    BD_BUY_SELL: "SELL",
    BD_QTY_TRD: "1,10,00,000",
    BD_TP_WATP: "14.92",
    BD_REMARKS: null,
  },
  // Zero-quantity row → dropped.
  {
    BD_DT_DATE: "31-JUL-2026",
    BD_SYMBOL: "X",
    BD_CLIENT_NAME: "Y",
    BD_BUY_SELL: "BUY",
    BD_QTY_TRD: "0",
  },
];

export const SAMPLE_NSE_PLEDGE_ROWS: NsePledgeRawRow[] = [
  {
    symbol: "ADANIPOWER",
    company: "Adani Power Limited",
    promoterName: "Promoter Holdco Pvt Ltd",
    eventType: "Pledge",
    noOfShares: "1,20,00,000",
    perOfShares: "3.11",
    eventDate: "28-JUL-2026",
    intimDt: "30-JUL-2026",
    xbrl: "https://nsearchives.nseindia.com/corporate/pledge_sample.xml",
  },
  {
    symbol: "ADANIPOWER",
    company: "Adani Power Limited",
    promoterName: "Promoter Holdco Pvt Ltd",
    eventType: "Invocation",
    noOfShares: "40,00,000",
    perOfShares: "1.04",
    eventDate: "30-JUL-2026",
    intimDt: "31-JUL-2026",
  },
];

/** First two rows recorded live (non-insider, kept verbatim shape); third synthesized as an insider filing. */
export const SAMPLE_BSE_ANNOUNCEMENTS: BseAnnouncementRow[] = [
  {
    SCRIP_CD: 532686,
    SLONGNAME: "Kernex Microsystems India Ltd",
    NEWSSUB:
      "Kernex Microsystems India Ltd - 532686 - Announcement under Regulation 30 (LODR)-Award_of_Order_Receipt_of_Order",
    HEADLINE: "Award of Order",
    CATEGORYNAME: "Company Update",
    SUBCATNAME: "Award of Order / Receipt of Order",
    NEWS_DT: "2026-08-02T09:01:34.217",
    ATTACHMENTNAME: "sample-award.pdf",
    NSURL: null,
  },
  {
    SCRIP_CD: 521194,
    SLONGNAME: "SIL Investments Ltd",
    NEWSSUB: "SIL Investments Ltd - 521194 - Announcement under Regulation 30 (LODR)-Cessation",
    HEADLINE: "Cessation",
    CATEGORYNAME: "Company Update",
    SUBCATNAME: "Cessation",
    NEWS_DT: "2026-08-02T09:00:32.563",
    ATTACHMENTNAME: null,
    NSURL: null,
  },
  {
    SCRIP_CD: 500325,
    SLONGNAME: "Reliance Industries Ltd",
    NEWSSUB:
      "Reliance Industries Ltd - 500325 - Disclosures under Reg. 7(2) of SEBI (Prohibition of Insider Trading) Regulations, 2015",
    HEADLINE: "Disclosures under Reg. 7(2) of SEBI (PIT) Regulations",
    CATEGORYNAME: "Insider Trading / SAST",
    SUBCATNAME: "Insider Trading",
    NEWS_DT: "2026-08-01T18:22:11.000",
    ATTACHMENTNAME: "insider-sample.pdf",
    NSURL: null,
  },
];

/** Recorded live 2026-08-02 (truncated to the parseable core). */
export const SAMPLE_BSE_SCRIP_SEARCH_HTML = `<li class='quotemenu quotemenuselect'><a id='/stock-share-price/reliance-industries-ltd/reliance/500325/' href='/stock-share-price/reliance-industries-ltd/reliance/500325/'><strong>RELIANCE</strong> INDUSTRIES LTD<br /><span><strong>RELIANCE</strong>&nbsp;&nbsp;&nbsp;INE002A01018&nbsp;&nbsp;&nbsp;500325</span></a></li>`;
