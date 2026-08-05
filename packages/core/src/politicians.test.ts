import { describe, expect, it } from "vitest";

import {
  disclosureLagDays,
  formatAmountBracket,
  isLateDisclosure,
  normalizeDisclosureDate,
  normalizePoliticianName,
  normalizePoliticianTxnType,
  parseAmountRange,
  parseStockWatcherFeed,
  parseStockWatcherRecord,
  politicianDedupKey,
  politicianExternalKey,
} from "./politicians";
import { parseEdgarSubmissionProfile, sicToSector } from "./sic";

describe("STOCK Act amount brackets", () => {
  it("splits a bracket into min and max", () => {
    expect(parseAmountRange("$1,001 - $15,000")).toEqual({
      min: 1001,
      max: 15000,
      label: "$1,001 - $15,000",
    });
    expect(parseAmountRange("$1,000,001 - $5,000,000")).toMatchObject({
      min: 1_000_001,
      max: 5_000_000,
    });
  });

  it("leaves an open-ended top bracket with no maximum", () => {
    // "Over $50,000,000" genuinely has no upper bound in the filing.
    expect(parseAmountRange("Over $50,000,000")).toMatchObject({ min: 50_000_000, max: null });
    expect(parseAmountRange("$1,000,001 +")).toMatchObject({ min: 1_000_001, max: null });
  });

  it("returns nulls rather than inventing a figure", () => {
    for (const raw of [null, undefined, "", "--", "Unknown"]) {
      const parsed = parseAmountRange(raw);
      expect(parsed.min).toBeNull();
      expect(parsed.max).toBeNull();
    }
  });
});

describe("formatAmountBracket", () => {
  it("renders a bracket, never a point value", () => {
    expect(formatAmountBracket(1001, 15000)).toBe("$1,001–$15,000");
    expect(formatAmountBracket("15001.00", "50000.00")).toBe("$15,001–$50,000");
  });

  it("keeps an open-ended top bracket open", () => {
    // "Over $50,000,000" has no upper bound in the filing; printing
    // "$50,000,000" would assert a maximum that does not exist.
    expect(formatAmountBracket(50_000_000, null)).toBe("$50,000,000+");
  });

  it("handles a lower bound we never saw", () => {
    expect(formatAmountBracket(null, 15000)).toBe("up to $15,000");
  });

  it("says nothing was disclosed rather than showing zero", () => {
    expect(formatAmountBracket(null, null)).toBe("an undisclosed amount");
    expect(formatAmountBracket(null, null, "not disclosed")).toBe("not disclosed");
    expect(formatAmountBracket("", "")).toBe("an undisclosed amount");
  });

  it("never produces a bare figure that could read as an exact amount", () => {
    // Every non-empty rendering must carry a range marker: an en dash, a
    // trailing +, or an explicit "up to".
    const renderings = [
      formatAmountBracket(1001, 15000),
      formatAmountBracket(50_000_000, null),
      formatAmountBracket(null, 15000),
    ];
    for (const text of renderings) {
      expect(text, text).toMatch(/–|\+|up to/);
    }
  });
});

describe("stock-watcher parsing", () => {
  const houseRecord = {
    disclosure_year: 2026,
    disclosure_date: "08/04/2026",
    transaction_date: "2026-07-15",
    owner: "Joint",
    ticker: "ZZTEST",
    asset_description: "ZZ Test Corporation",
    type: "purchase",
    amount: "$15,001 - $50,000",
    representative: "Hon. ZZ Representative Testcase",
    district: "ZZ01",
    ptr_link: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/00000000.pdf",
  };

  it("parses a House record", () => {
    const parsed = parseStockWatcherRecord(houseRecord, "house")!;
    expect(parsed.politicianName).toBe("Hon. ZZ Representative Testcase");
    expect(parsed.ticker).toBe("ZZTEST");
    expect(parsed.txnType).toBe("purchase");
    expect(parsed.txnDate).toBe("2026-07-15");
    expect(parsed.disclosedAt).toBe("2026-08-04");
    expect(parsed.amountMin).toBe(15_001);
    expect(parsed.amountMax).toBe(50_000);
    expect(parsed.owner).toBe("joint");
    // District implies the state when the dataset omits it.
    expect(parsed.state).toBe("ZZ");
    expect(parsed.sourceUrl).toContain("disclosures-clerk.house.gov");
  });

  it("parses a Senate record with its different field names and casing", () => {
    const parsed = parseStockWatcherRecord(
      {
        transaction_date: "07/20/2026",
        disclosure_date: "08/01/2026",
        owner: "Spouse",
        ticker: "ZZSEN",
        asset_description: "ZZ Senate Test Inc",
        asset_type: "Stock",
        type: "Sale (Full)",
        amount: "$50,001 - $100,000",
        senator: "ZZ Senator Fictional",
        comment: "--",
      },
      "senate",
    )!;
    expect(parsed.politicianName).toBe("ZZ Senator Fictional");
    expect(parsed.txnType).toBe("sale_full");
    expect(parsed.txnDate).toBe("2026-07-20");
    expect(parsed.assetType).toBe("Stock");
    expect(parsed.comment).toBeNull(); // "--" is a placeholder, not a comment
  });

  it("drops a row rather than filling in what it lacks", () => {
    expect(parseStockWatcherRecord({ ...houseRecord, representative: null }, "house")).toBeNull();
    expect(parseStockWatcherRecord({ ...houseRecord, transaction_date: "" }, "house")).toBeNull();
    expect(parseStockWatcherRecord({ ...houseRecord, type: "gibberish" }, "house")).toBeNull();
    expect(parseStockWatcherRecord(null, "house")).toBeNull();
  });

  it("rejects non-ticker placeholders", () => {
    for (const ticker of ["--", "N/A", "", "some long description"]) {
      expect(parseStockWatcherRecord({ ...houseRecord, ticker }, "house")!.ticker).toBeNull();
    }
  });

  it("keeps duplicate same-day disclosures distinct by occurrence", () => {
    const rows = parseStockWatcherFeed([houseRecord, houseRecord, houseRecord], "house");
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.dedupKey)).size).toBe(3);
    expect(rows.map((r) => r.dedupKey.slice(-2))).toEqual(["#0", "#1", "#2"]);
  });

  it("puts the bracket in the dedup key, so two brackets are two trades", () => {
    const base = parseStockWatcherRecord(houseRecord, "house")!;
    const other = parseStockWatcherRecord(
      { ...houseRecord, amount: "$100,001 - $250,000" },
      "house",
    )!;
    expect(politicianDedupKey(base)).not.toBe(politicianDedupKey(other));
  });

  it("normalizes honorifics so one person is one identity", () => {
    expect(normalizePoliticianName("Hon. ZZ Representative Testcase")).toBe(
      normalizePoliticianName("ZZ Representative Testcase"),
    );
    expect(politicianExternalKey("house", "Hon. Jane Fictional")).toBe(
      politicianExternalKey("house", "Jane Fictional"),
    );
    // Chamber is part of the identity: a House and a Senate filer never merge.
    expect(politicianExternalKey("house", "Jane Fictional")).not.toBe(
      politicianExternalKey("senate", "Jane Fictional"),
    );
  });

  it("accepts both date formats and refuses anything else", () => {
    expect(normalizeDisclosureDate("08/04/2026")).toBe("2026-08-04");
    expect(normalizeDisclosureDate("2026-08-04")).toBe("2026-08-04");
    expect(normalizeDisclosureDate("4 August 2026")).toBeNull();
    expect(normalizeDisclosureDate(null)).toBeNull();
  });

  it("maps every sale variant", () => {
    expect(normalizePoliticianTxnType("Sale (Partial)")).toBe("sale_partial");
    expect(normalizePoliticianTxnType("sale_full")).toBe("sale_full");
    expect(normalizePoliticianTxnType("Exchange")).toBe("exchange");
    expect(normalizePoliticianTxnType("nonsense")).toBeNull();
  });
});

describe("STOCK Act disclosure deadline", () => {
  it("measures the lag between the trade and its disclosure", () => {
    expect(disclosureLagDays("2026-07-01", "2026-08-01")).toBe(31);
    expect(disclosureLagDays("2026-07-01", null)).toBeNull();
  });

  it("flags filings past the 45-day deadline", () => {
    expect(isLateDisclosure("2026-06-01", "2026-07-10")).toBe(false); // 39 days
    expect(isLateDisclosure("2026-06-01", "2026-07-20")).toBe(true); // 49 days
    // Unknown disclosure date is not evidence of lateness.
    expect(isLateDisclosure("2026-06-01", null)).toBe(false);
  });
});

describe("SIC → sector", () => {
  it("prefers a narrow override to the broad division it sits inside", () => {
    // 2834 is inside the 2800–2899 chemicals range, but pharma is Health Care.
    expect(sicToSector("2834")).toBe("Health Care");
    expect(sicToSector("2810")).toBe("Materials");
    // 7372 is inside 7300–7399 business services, but software is Technology.
    expect(sicToSector("7372")).toBe("Technology");
    expect(sicToSector("7311")).toBe("Communication Services");
  });

  it("refuses to guess", () => {
    expect(sicToSector(null)).toBeNull();
    expect(sicToSector(undefined)).toBeNull();
    expect(sicToSector("")).toBeNull();
    expect(sicToSector("abc")).toBeNull();
    expect(sicToSector(0)).toBeNull();
  });

  it("parses an EDGAR submissions payload", () => {
    const profile = parseEdgarSubmissionProfile({
      cik: 320193,
      sic: "3571",
      sicDescription: "Electronic Computers",
      tickers: ["ZZAAPL"],
      exchanges: ["Nasdaq"],
    })!;
    expect(profile.sicCode).toBe("3571");
    expect(profile.industry).toBe("Electronic Computers");
    expect(profile.sector).toBe("Technology");
    expect(profile.exchange).toBe("Nasdaq");
    expect(profile.tickers).toEqual(["ZZAAPL"]);
  });

  it("survives a payload with no SIC", () => {
    const profile = parseEdgarSubmissionProfile({ cik: 1, tickers: [] })!;
    expect(profile.sicCode).toBeNull();
    expect(profile.sector).toBeNull();
    expect(parseEdgarSubmissionProfile({})).toBeNull();
    expect(parseEdgarSubmissionProfile(null)).toBeNull();
  });
});
