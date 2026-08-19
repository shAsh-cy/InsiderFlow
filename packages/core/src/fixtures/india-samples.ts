/**
 * Recorded fixtures for the India local-scrape provider tests.
 *
 * BSE rows: field names recorded from a live AnnSubCategoryGetData /
 * getqouteSearch probe on 2026-08-02 (values partly anonymized; one
 * insider-category row synthesized with the same field names).
 * NSE SAST/bulk/pledge rows and the PIT V2 samples at the bottom of this
 * file were recorded LIVE from a residential Indian line (2026-08-18/19).
 * The legacy `SAMPLE_NSE_PIT_ROWS` below match the RETIRED corporates-pit
 * JSON shape and are kept only to exercise the deprecated mapper.
 */
import type {
  BseAnnouncementRow,
  NseBulkBlockRawRow,
  NsePitIndexRow,
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

/**
 * A REAL PIT XBRL instance, recorded live 2026-08-19 from
 * `corporates-pit-gg` (JAYSREETEA, Regulation 7 (2)). ONE filing carrying
 * TWO transactions — same person, same day, one executed on each exchange.
 *
 * Kept verbatim, entity encoding and all: `NameOfTheCompany` contains
 * `&amp;`, and the taxonomy misspells "Acquistion". A tidied fixture would
 * test a document NSE does not produce.
 */
export const SAMPLE_NSE_PIT_XBRL = String.raw`<?xml version="1.0" encoding="UTF-8"?>
<!--PIT V2.0 (30-04-2026)-->
<xbrli:xbrl xmlns:in-bse-co="http://www.bseindia.com/xbrl/co/2017-09-15/in-bse-co" xmlns:in-bse-co-roles="http://www.bseindia.com/xbrl/co/2017-09-15/in-bse-co-roles" xmlns:xbrldt="http://xbrl.org/2005/xbrldt" xmlns:nonnum="http://www.xbrl.org/dtr/type/non-numeric" xmlns:in-bse-co-type="http://www.bseindia.com/xbrl/co/2017-09-15/in-bse-co-types" xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:net="http://www.xbrl.org/2009/role/net" xmlns:num="http://www.xbrl.org/dtr/type/numeric" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:negated="http://www.xbrl.org/2009/role/negated" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xl="http://www.xbrl.org/2003/XLink"><link:schemaRef xlink:type="simple" xlink:href="in-bse-co-2017-09-15.xsd"/><xbrli:context id="MainI"><xbrli:entity><xbrli:identifier scheme="http://www.bseindia.com/bse-cg/ScripCode">509715</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-08-18</xbrli:instant></xbrli:period></xbrli:context><xbrli:context id="Disclosure1"><xbrli:entity><xbrli:identifier scheme="http://www.bseindia.com/bse-cg/ScripCode">509715</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-08-18</xbrli:instant></xbrli:period><xbrli:scenario><xbrldi:typedMember dimension="in-bse-co:ChangeInHoldingOfSecuritiesOfPromotersAxis"><in-bse-co:ChangeInHoldingOfSecuritiesOfPromotersDomain>Disclosure1</in-bse-co:ChangeInHoldingOfSecuritiesOfPromotersDomain></xbrldi:typedMember></xbrli:scenario></xbrli:context><xbrli:context id="Disclosure2"><xbrli:entity><xbrli:identifier scheme="http://www.bseindia.com/bse-cg/ScripCode">509715</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-08-18</xbrli:instant></xbrli:period><xbrli:scenario><xbrldi:typedMember dimension="in-bse-co:ChangeInHoldingOfSecuritiesOfPromotersAxis"><in-bse-co:ChangeInHoldingOfSecuritiesOfPromotersDomain>Disclosure2</in-bse-co:ChangeInHoldingOfSecuritiesOfPromotersDomain></xbrldi:typedMember></xbrli:scenario></xbrli:context><xbrli:unit id="INR"><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unit><xbrli:unit id="pure"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit><xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit><in-bse-co:ScripCode contextRef="MainI">509715</in-bse-co:ScripCode><in-bse-co:Symbol contextRef="MainI">JAYSREETEA</in-bse-co:Symbol><in-bse-co:MSEISymbol contextRef="MainI">NOTLISTED</in-bse-co:MSEISymbol><in-bse-co:NameOfTheCompany contextRef="MainI">JAY SHREE TEA &amp; INDUSTRIES LTD</in-bse-co:NameOfTheCompany><in-bse-co:NameOfTheSignatory contextRef="MainI">R.K.GANERIWALA</in-bse-co:NameOfTheSignatory><in-bse-co:DesignationOfSignatory contextRef="MainI">Company Secretary and Compliance Officer</in-bse-co:DesignationOfSignatory><in-bse-co:Place contextRef="MainI">KOLKATA</in-bse-co:Place><in-bse-co:DateOfFiling contextRef="MainI">2026-08-18</in-bse-co:DateOfFiling><in-bse-co:ISINCode contextRef="MainI">INE364A01020</in-bse-co:ISINCode><in-bse-co:DisclosureUnderRegulation contextRef="MainI">Regulation 7 (2)</in-bse-co:DisclosureUnderRegulation><in-bse-co:RevisedFilling contextRef="MainI">false</in-bse-co:RevisedFilling><in-bse-co:TypeOfInstrument contextRef="Disclosure1">Equity</in-bse-co:TypeOfInstrument><in-bse-co:CategoryOfPerson contextRef="Disclosure1">Promoter and Director</in-bse-co:CategoryOfPerson><in-bse-co:NameOfThePerson contextRef="Disclosure1">MRS.JAYASHREE MOHTA</in-bse-co:NameOfThePerson><in-bse-co:IdentificationNumberOfDirectorOrCompany contextRef="Disclosure1">01034912</in-bse-co:IdentificationNumberOfDirectorOrCompany><in-bse-co:SecuritiesHeldPriorToAcquisitionOrDisposalNumberOfSecurity contextRef="Disclosure1" unitRef="shares" decimals="INF">1105770</in-bse-co:SecuritiesHeldPriorToAcquisitionOrDisposalNumberOfSecurity><in-bse-co:SecuritiesHeldPriorToAcquisitionOrDisposalPercentageOfShareholding contextRef="Disclosure1" unitRef="pure" decimals="INF">0.0383</in-bse-co:SecuritiesHeldPriorToAcquisitionOrDisposalPercentageOfShareholding><in-bse-co:SecuritiesAcquiredOrDisposedNumberOfSecurity contextRef="Disclosure1" unitRef="shares" decimals="INF">1252262</in-bse-co:SecuritiesAcquiredOrDisposedNumberOfSecurity><in-bse-co:SecuritiesAcquiredOrDisposedValueOfSecurity contextRef="Disclosure1" unitRef="INR" decimals="0">110814212</in-bse-co:SecuritiesAcquiredOrDisposedValueOfSecurity><in-bse-co:SecuritiesAcquiredOrDisposedTransactionType contextRef="Disclosure1">Buy</in-bse-co:SecuritiesAcquiredOrDisposedTransactionType><in-bse-co:SecuritiesHeldPostAcquistionOrDisposalNumberOfSecurity contextRef="Disclosure1" unitRef="shares" decimals="INF">2358032</in-bse-co:SecuritiesHeldPostAcquistionOrDisposalNumberOfSecurity><in-bse-co:SecuritiesHeldPostAcquistionOrDisposalPercentageOfShareholding contextRef="Disclosure1" unitRef="pure" decimals="INF">0.0816</in-bse-co:SecuritiesHeldPostAcquistionOrDisposalPercentageOfShareholding><in-bse-co:DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyFromDate contextRef="Disclosure1">2026-08-17</in-bse-co:DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyFromDate><in-bse-co:DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyToDate contextRef="Disclosure1">2026-08-17</in-bse-co:DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyToDate><in-bse-co:ModeOfAcquisitionOrDisposal contextRef="Disclosure1">Market Purchase</in-bse-co:ModeOfAcquisitionOrDisposal><in-bse-co:DateOfIntimationToCompany contextRef="Disclosure1">2026-08-18</in-bse-co:DateOfIntimationToCompany><in-bse-co:ExchangeOnWhichTheTradeWasExecuted contextRef="Disclosure1">BSE</in-bse-co:ExchangeOnWhichTheTradeWasExecuted><in-bse-co:TypeOfInstrument contextRef="Disclosure2">Equity</in-bse-co:TypeOfInstrument><in-bse-co:CategoryOfPerson contextRef="Disclosure2">Promoter and Director</in-bse-co:CategoryOfPerson><in-bse-co:NameOfThePerson contextRef="Disclosure2">MRS.JAYASHREE MOHTA</in-bse-co:NameOfThePerson><in-bse-co:IdentificationNumberOfDirectorOrCompany contextRef="Disclosure2">01034912</in-bse-co:IdentificationNumberOfDirectorOrCompany><in-bse-co:SecuritiesHeldPriorToAcquisitionOrDisposalNumberOfSecurity contextRef="Disclosure2" unitRef="shares" decimals="INF">2358032</in-bse-co:SecuritiesHeldPriorToAcquisitionOrDisposalNumberOfSecurity><in-bse-co:SecuritiesHeldPriorToAcquisitionOrDisposalPercentageOfShareholding contextRef="Disclosure2" unitRef="pure" decimals="INF">0.0816</in-bse-co:SecuritiesHeldPriorToAcquisitionOrDisposalPercentageOfShareholding><in-bse-co:SecuritiesAcquiredOrDisposedNumberOfSecurity contextRef="Disclosure2" unitRef="shares" decimals="INF">11223</in-bse-co:SecuritiesAcquiredOrDisposedNumberOfSecurity><in-bse-co:SecuritiesAcquiredOrDisposedValueOfSecurity contextRef="Disclosure2" unitRef="INR" decimals="0">982000</in-bse-co:SecuritiesAcquiredOrDisposedValueOfSecurity><in-bse-co:SecuritiesAcquiredOrDisposedTransactionType contextRef="Disclosure2">Buy</in-bse-co:SecuritiesAcquiredOrDisposedTransactionType><in-bse-co:SecuritiesHeldPostAcquistionOrDisposalNumberOfSecurity contextRef="Disclosure2" unitRef="shares" decimals="INF">2369255</in-bse-co:SecuritiesHeldPostAcquistionOrDisposalNumberOfSecurity><in-bse-co:SecuritiesHeldPostAcquistionOrDisposalPercentageOfShareholding contextRef="Disclosure2" unitRef="pure" decimals="INF">0.082</in-bse-co:SecuritiesHeldPostAcquistionOrDisposalPercentageOfShareholding><in-bse-co:DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyFromDate contextRef="Disclosure2">2026-08-17</in-bse-co:DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyFromDate><in-bse-co:DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyToDate contextRef="Disclosure2">2026-08-17</in-bse-co:DateOfAllotmentAdviceOrAcquisitionOfSharesOrSaleOfSharesSpecifyToDate><in-bse-co:ModeOfAcquisitionOrDisposal contextRef="Disclosure2">Market Purchase</in-bse-co:ModeOfAcquisitionOrDisposal><in-bse-co:DateOfIntimationToCompany contextRef="Disclosure2">2026-08-18</in-bse-co:DateOfIntimationToCompany><in-bse-co:ExchangeOnWhichTheTradeWasExecuted contextRef="Disclosure2">NSE</in-bse-co:ExchangeOnWhichTheTradeWasExecuted></xbrli:xbrl>
`;

/**
 * Index rows from the same call. Every field name here was read off the
 * live payload — none is inferred.
 */
export const SAMPLE_NSE_PIT_INDEX_ROWS: NsePitIndexRow[] = [
  {
    appId: "2337",
    broadcastDateTime: "18-Aug-2026 20:38:34",
    companyName: "JAY SHREE TEA & INDUSTRIES LTD",
    diff: "00:00:00",
    exchdisstime: "18-Aug-2026 20:38:35",
    ixbrl: "https://nsearchives.nseindia.com/corporate/ixbrl/IT_1139_20260818_203834364_WEB.html",
    ixbrlFileSize: "28.18 KB",
    prevAppId: null,
    regulation: "Regulation 7 (2)",
    revisionRemark: null,
    symbol: "JAYSREETEA",
    typeOfSubmission: "Original",
    xbrlFileSize: "8.12 KB",
    xmlFileName:
      "https://nsearchives.nseindia.com/corporate/xbrl/IT_1139_WebXMLFile_20260818_203834308.xml",
  },
  {
    appId: "2336",
    broadcastDateTime: "18-Aug-2026 18:49:34",
    companyName: "T T LIMITED",
    diff: "00:00:00",
    exchdisstime: "18-Aug-2026 18:49:35",
    ixbrl: "https://nsearchives.nseindia.com/corporate/ixbrl/IT_2534_20260818_184934159_WEB.html",
    ixbrlFileSize: "21.72 KB",
    prevAppId: null,
    regulation: "Regulation 7 (2)",
    revisionRemark: null,
    symbol: "TTL",
    typeOfSubmission: "Original",
    xbrlFileSize: "5.00 KB",
    xmlFileName:
      "https://nsearchives.nseindia.com/corporate/xbrl/IT_2534_WebXMLFile_20260818_184934120.xml",
  },
  {
    appId: "2354",
    broadcastDateTime: "18-Aug-2026 18:24:17",
    companyName: "Landmark Cars Limited",
    diff: "00:00:02",
    exchdisstime: "18-Aug-2026 18:24:19",
    ixbrl: "https://nsearchives.nseindia.com/corporate/ixbrl/IT_20392_20260818_182417248_WEB.html",
    ixbrlFileSize: "21.89 KB",
    prevAppId: null,
    regulation: "Regulation 7 (2)",
    revisionRemark: null,
    symbol: "LANDMARK",
    typeOfSubmission: "Original",
    xbrlFileSize: "5.18 KB",
    xmlFileName:
      "https://nsearchives.nseindia.com/corporate/xbrl/IT_20392_WebXMLFile_20260818_182417211.xml",
  },
];
