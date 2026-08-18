import { describe, expect, it } from "vitest";

import { SAMPLE_NSE_PIT_INDEX_ROWS, SAMPLE_NSE_PIT_XBRL } from "../fixtures/india-samples";
import { mapPitXbrlToDisclosures, nsePitIndexUrl, nsePitUrl, parsePitXbrl } from "./india-scrape";

/**
 * NSE PIT V2 — the endpoint that carries India's actual insider trades.
 *
 * ── WHY THESE TESTS EXIST ─────────────────────────────────────────────
 *
 * For three rounds this repository recorded that NSE "soft-fails to empty
 * data from datacenter IPs", and carried the PIT row shape as INFERRED on
 * that basis. r15 disproved the explanation from a residential Indian
 * line — ninety days, zero rows — without finding the cause. r16 found it:
 * `corporates-pit` is RETIRED. It answers `HTTP 200` with a well-formed,
 * empty envelope to everyone.
 *
 * A dead endpoint returning 200 and no data is the worst failure shape
 * available. It is indistinguishable from a quiet week, and it was read as
 * one for months.
 *
 * The live path is `corporates-pit-gg`, which NSE's own page names in an
 * inline script (`activeApiName`). It returns a FILING INDEX; the trades
 * are in the XBRL document each row links to. Everything asserted below
 * was recorded from a real filing, so the field names in `india-scrape.ts`
 * are now CONFIRMED rather than inferred — which is the whole point.
 */

describe("the retired endpoint and its replacement", () => {
  it("still builds the retired URL, because the name is what people search for", () => {
    // Kept deliberately: someone reading an old log or an old branch will
    // grep for `corporates-pit`, and the deprecation note is attached to
    // this function. Deleting it would delete the explanation with it.
    expect(nsePitUrl("2026-07-28", "2026-08-01")).toBe(
      "https://www.nseindia.com/api/corporates-pit?index=equities&from_date=28-07-2026&to_date=01-08-2026",
    );
  });

  it("builds the live index URL — the name NSE's own page declares", () => {
    expect(nsePitIndexUrl("2026-07-28", "2026-08-01")).toBe(
      "https://www.nseindia.com/api/corporates-pit-gg?index=equities&from_date=28-07-2026&to_date=01-08-2026",
    );
  });

  it("the two differ only in the path, so nothing else silently changed", () => {
    const retired = new URL(nsePitUrl("2026-07-28", "2026-08-01"));
    const live = new URL(nsePitIndexUrl("2026-07-28", "2026-08-01"));
    expect(live.searchParams.toString()).toBe(retired.searchParams.toString());
    expect(live.pathname).not.toBe(retired.pathname);
  });
});

describe("the index rows are what NSE actually returned", () => {
  it("carries a filing, not a trade — no quantity or value anywhere", () => {
    const row = SAMPLE_NSE_PIT_INDEX_ROWS[0]!;
    expect(row.symbol).toBe("JAYSREETEA");
    expect(row.regulation).toMatch(/^Regulation 7 \([23]\)$/);
    expect(row.typeOfSubmission).toBe("Original");
    // The thing that makes this a two-step fetch: no numbers in the index.
    const keys = Object.keys(row);
    expect(keys.filter((k) => /qty|quantity|shares|value|price/i.test(k))).toEqual([]);
  });

  it("links the machine-readable document, on the archives host", () => {
    const row = SAMPLE_NSE_PIT_INDEX_ROWS[0]!;
    expect(row.xmlFileName).toMatch(
      /^https:\/\/nsearchives\.nseindia\.com\/corporate\/xbrl\/.+\.xml$/,
    );
    expect(row.ixbrl).toMatch(/^https:\/\/nsearchives\.nseindia\.com\/corporate\/ixbrl\/.+\.html$/);
  });
});

describe("parsePitXbrl, against a real filing", () => {
  const parsed = parsePitXbrl(SAMPLE_NSE_PIT_XBRL);

  it("reads the filing-level facts out of the MainI context", () => {
    expect(parsed.filing.symbol).toBe("JAYSREETEA");
    expect(parsed.filing.isin).toBe("INE364A01020");
    expect(parsed.filing.scripCode).toBe("509715");
    expect(parsed.filing.regulation).toBe("Regulation 7 (2)");
    expect(parsed.filing.dateOfFiling).toBe("2026-08-18");
    expect(parsed.filing.revised).toBe(false);
  });

  it("decodes XML entities rather than carrying them into the database", () => {
    // The filed name is "JAY SHREE TEA &amp; INDUSTRIES LTD". An ampersand
    // in an issuer name is routine, and it is the same character class that
    // breaks Telegram's parser two packages away.
    expect(parsed.filing.companyName).toBe("JAY SHREE TEA & INDUSTRIES LTD");
    expect(parsed.filing.companyName).not.toContain("&amp;");
  });

  it("returns EVERY transaction in the document, not just the first", () => {
    // This filing carries two: the same person, the same day, one executed
    // on each exchange. Treating a document as a single trade would have
    // silently halved the tape — and nothing upstream would have noticed,
    // because the count would still have looked plausible.
    expect(parsed.disclosures).toHaveLength(2);
    expect(parsed.disclosures.map((d) => d.exchange)).toEqual(["BSE", "NSE"]);
  });

  it("reads the trade numbers as filed", () => {
    const [first, second] = parsed.disclosures;
    expect(first).toMatchObject({
      personName: "MRS.JAYASHREE MOHTA",
      personCategory: "Promoter and Director",
      identificationNumber: "01034912",
      instrument: "Equity",
      sharesBefore: 1105770,
      shares: 1252262,
      value: 110814212,
      transactionType: "Buy",
      sharesAfter: 2358032,
      mode: "Market Purchase",
      fromDate: "2026-08-17",
      toDate: "2026-08-17",
    });
    // The second picks up where the first left off, which is the internal
    // check that the contexts were not merged or reordered.
    expect(second!.sharesBefore).toBe(first!.sharesAfter);
    expect(second!.sharesAfter).toBe(2369255);
  });

  it("reads the field NSE misspells, because the source misspells it", () => {
    // `SecuritiesHeldPostAcquistionOrDisposal...` — "Acquistion". Spelling
    // it correctly in the parser reads every post-trade holding as null,
    // and null is a legal value here, so nothing would have thrown.
    expect(parsed.disclosures.every((d) => d.sharesAfter !== null)).toBe(true);
  });

  it("passes percentages through as filed instead of guessing the unit", () => {
    // 1,105,770 shares reported as 0.0383. That reads as a fraction, and
    // SAST's equivalent fields are whole percents — but deciding it needs a
    // shares-outstanding figure this document does not carry, so the filed
    // number is what is stored and the ambiguity is named in the type.
    expect(parsed.disclosures[0]!.pctBeforeAsFiled).toBe(0.0383);
    expect(parsed.disclosures[0]!.pctAfterAsFiled).toBe(0.0816);
  });

  it("returns an empty filing rather than throwing on a document with no facts", () => {
    const empty = parsePitXbrl("<?xml version='1.0'?><xbrli:xbrl></xbrli:xbrl>");
    expect(empty.disclosures).toEqual([]);
    expect(empty.filing.symbol).toBeNull();
    expect(empty.filing.revised).toBe(false);
  });

  it("orders contexts numerically, so Disclosure10 does not precede Disclosure2", () => {
    // Built from the real document by renaming its two contexts, so the
    // shape stays honest while the ordering question gets asked.
    const many = SAMPLE_NSE_PIT_XBRL.replaceAll("Disclosure1", "Disclosure10").replaceAll(
      "Disclosure2",
      "Disclosure9",
    );
    const order = parsePitXbrl(many).disclosures.map((d) => d.exchange);
    expect(order).toEqual(["NSE", "BSE"]);
  });
});

describe("mapPitXbrlToDisclosures, into the feed contract", () => {
  const parsed = parsePitXbrl(SAMPLE_NSE_PIT_XBRL);

  it("produces one record per transaction, in the shape a licensed feed would", () => {
    const records = mapPitXbrlToDisclosures(parsed, SAMPLE_NSE_PIT_INDEX_ROWS[0]);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      symbol: "JAYSREETEA",
      company: "JAY SHREE TEA & INDUSTRIES LTD",
      acquirerName: "MRS.JAYASHREE MOHTA",
      personCategory: "Promoter and Director",
      securityType: "Equity",
      quantity: 1252262,
      value: 110814212,
      mode: "Market Purchase",
      transactionType: "Buy",
      date: "2026-08-17",
      exchange: "BSE",
    });
  });

  it("dates the record by the TRANSACTION, never by the intimation", () => {
    // The filing was intimated on the 18th and the trade happened on the
    // 17th. Dating it by intimation would put every Indian trade a day or
    // more late and quietly break cross-source dedup against a licensed
    // feed that dates it correctly.
    const records = mapPitXbrlToDisclosures(parsed);
    expect(records.every((r) => r.date === "2026-08-17")).toBe(true);
    expect(parsed.disclosures[0]!.intimationDate).toBe("2026-08-18");
  });

  it("falls back to the index row's symbol when the document omits one", () => {
    const withoutSymbol = { ...parsed, filing: { ...parsed.filing, symbol: null } };
    const records = mapPitXbrlToDisclosures(withoutSymbol, { symbol: "ZZFALLBACK" });
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.symbol === "ZZFALLBACK")).toBe(true);
  });

  it("drops a row with no identifiable symbol rather than inventing one", () => {
    const withoutSymbol = { ...parsed, filing: { ...parsed.filing, symbol: null } };
    expect(mapPitXbrlToDisclosures(withoutSymbol)).toEqual([]);
  });

  it("drops a transaction with no person or no usable date", () => {
    const anonymous = {
      ...parsed,
      disclosures: [
        { ...parsed.disclosures[0]!, personName: null },
        { ...parsed.disclosures[1]!, fromDate: null, toDate: null, intimationDate: null },
      ],
    };
    expect(mapPitXbrlToDisclosures(anonymous)).toEqual([]);
  });
});
