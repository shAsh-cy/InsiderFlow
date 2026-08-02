import { describe, expect, it } from "vitest";

import {
  SAMPLE_BSE_ANNOUNCEMENTS,
  SAMPLE_BSE_SCRIP_SEARCH_HTML,
  SAMPLE_NSE_BULK_ROWS,
  SAMPLE_NSE_PIT_ROWS,
  SAMPLE_NSE_PLEDGE_ROWS,
  SAMPLE_NSE_SAST_ROWS,
} from "../fixtures/india-samples";
import { indiaAdapter } from "./india";
import {
  bseAnnouncementsUrl,
  filterBseInsiderAnnouncements,
  mapNsePitToDisclosure,
  normalizeBulkBlockRows,
  normalizePledgeRows,
  normalizeSastRows,
  nsePitUrl,
  parseBseScripSearch,
} from "./india-scrape";

describe("NSE PIT → feed contract → UnifiedTransaction", () => {
  it("builds the PIT URL with DD-MM-YYYY dates", () => {
    expect(nsePitUrl("2026-07-28", "2026-08-01")).toBe(
      "https://www.nseindia.com/api/corporates-pit?index=equities&from_date=28-07-2026&to_date=01-08-2026",
    );
  });

  it("maps raw rows into the exact INDIA_FEED_URL record shape and drops malformed rows", () => {
    const records = SAMPLE_NSE_PIT_ROWS.map(mapNsePitToDisclosure).filter(
      (r): r is NonNullable<typeof r> => r !== null,
    );
    expect(records).toHaveLength(2); // the acquirer-less row is dropped
    expect(records[0]).toMatchObject({
      symbol: "RELIANCE",
      acquirerName: "Kumar Rajesh",
      personCategory: "Promoters",
      quantity: "1,00,000",
      value: "24,50,00,000",
      mode: "Market Purchase",
      transactionType: "Buy",
      date: "30-JUL-2026",
      exchange: "NSE",
    });

    // The whole point: scraped rows flow through the SAME adapter as a licensed feed.
    const unified = indiaAdapter.normalize({ records });
    expect(unified).toHaveLength(2);
    expect(unified[0]).toMatchObject({
      source: "nse-bse",
      market: "IN",
      country: "IN",
      currency: "INR",
      code: "P",
      shares: 100_000,
      value: 245_000_000,
      relevance: "opportunistic",
    });
    expect(unified[1]).toMatchObject({ code: "S", acquiredDisposed: "D" });
  });
});

describe("normalizeSastRows", () => {
  const records = normalizeSastRows(SAMPLE_NSE_SAST_ROWS);

  it("normalizes acquisitions and disposals (live field names; no value on this endpoint)", () => {
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      symbol: "TATAMOTORS",
      acquirerName: "Horizon Growth Fund LP",
      regulation: "29(2)",
      category: "Public",
      side: "acquisition",
      shares: 3_500_000,
      sharesPctAfter: 5.91,
      value: null, // corporate-sast-reg29 carries no monetary value
      txnDate: "2026-07-30",
      intimatedAt: "2026-07-31",
    });
    expect(records[1]).toMatchObject({ side: "disposal", shares: 1_200_000, value: null });
  });

  it("builds stable identities for the dedup layer", () => {
    expect(records[0]!.identity).toBe(
      "IN|SAST|TATAMOTORS|HORIZON GROWTH FUND LP|2026-07-30|3500000",
    );
  });
});

describe("normalizeBulkBlockRows", () => {
  it("normalizes deals, computes INR value, and drops zero-quantity rows", () => {
    const deals = normalizeBulkBlockRows(SAMPLE_NSE_BULK_ROWS, "bulk");
    expect(deals).toHaveLength(2);
    expect(deals[0]).toMatchObject({
      dealType: "bulk",
      dealDate: "2026-07-31",
      symbol: "IDEA",
      clientName: "QUANT ALPHA LLP",
      side: "buy",
      quantity: 25_000_000,
      wap: 14.85,
      value: 371_250_000,
    });
    // Same client both sides on the same day → two distinct identities.
    expect(deals[0]!.identity).not.toBe(deals[1]!.identity);
  });
});

describe("normalizePledgeRows", () => {
  it("normalizes pledge and invocation events", () => {
    const events = normalizePledgeRows(SAMPLE_NSE_PLEDGE_ROWS);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      symbol: "ADANIPOWER",
      promoterName: "Promoter Holdco Pvt Ltd",
      eventType: "pledge",
      shares: 12_000_000,
      sharesPct: 3.11,
      eventDate: "2026-07-28",
    });
    expect(events[1]!.eventType).toBe("invoke");
  });
});

describe("BSE (shapes recorded live 2026-08-02)", () => {
  it("builds the announcements URL with empty dates meaning today", () => {
    expect(bseAnnouncementsUrl()).toContain("strPrevDate=&");
    expect(bseAnnouncementsUrl({ fromYmd: "20260730", toYmd: "20260801" })).toContain(
      "strPrevDate=20260730",
    );
  });

  it("filters insider/SAST announcements out of the general stream", () => {
    const filtered = filterBseInsiderAnnouncements(SAMPLE_BSE_ANNOUNCEMENTS);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({
      scripCode: "500325",
      company: "Reliance Industries Ltd",
      subCategory: "Insider Trading",
      newsDate: "2026-08-01",
      attachmentUrl: "https://www.bseindia.com/xml-data/corpfiling/AttachLive/insider-sample.pdf",
    });
  });

  it("parses scrip-search HTML into code + ISIN", () => {
    const matches = parseBseScripSearch(SAMPLE_BSE_SCRIP_SEARCH_HTML);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      scripCode: "500325",
      isin: "INE002A01018",
    });
    expect(matches[0]!.name).toContain("RELIANCE");
  });
});
