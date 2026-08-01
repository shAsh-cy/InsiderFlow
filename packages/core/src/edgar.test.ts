import { describe, expect, it } from "vitest";

import {
  edgarCurrentFeedUrl,
  edgarDailyFormIdxUrl,
  edgarSubmissionTextUrl,
  extractAcceptanceDatetime,
  extractOwnershipXml,
  parseCurrentFeed,
  parseDailyFormIdx,
} from "./edgar";
import { SAMPLE_FORM4_XML, wrapAsSubmissionText } from "./fixtures/form4-sample";

const SAMPLE_FEED = `<?xml version="1.0" encoding="ISO-8859-1"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Latest Filings - Form 4</title>
  <entry>
    <title>4 - DOE JANE A (0001214156) (Reporting)</title>
    <link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/320193/000032019326000123/0000320193-26-000123-index.htm"/>
    <category scheme="https://www.sec.gov/form-type" label="form type" term="4"/>
    <id>urn:tag:sec.gov,2008:accession-number=0000320193-26-000123</id>
    <updated>2026-07-31T17:05:14-04:00</updated>
  </entry>
  <entry>
    <title>4 - Apple Inc. (0000320193) (Issuer)</title>
    <link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/320193/000032019326000123/0000320193-26-000123-index.htm"/>
    <category scheme="https://www.sec.gov/form-type" label="form type" term="4"/>
    <id>urn:tag:sec.gov,2008:accession-number=0000320193-26-000123</id>
    <updated>2026-07-31T17:05:14-04:00</updated>
  </entry>
  <entry>
    <title>4/A - SMITH ROBERT (0009876543) (Reporting)</title>
    <link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/9876543/000098765432600004/0009876543-26-000004-index.htm"/>
    <category scheme="https://www.sec.gov/form-type" label="form type" term="4/A"/>
    <id>urn:tag:sec.gov,2008:accession-number=0009876543-26-000004</id>
    <updated>2026-07-31T17:04:02-04:00</updated>
  </entry>
</feed>`;

describe("parseCurrentFeed", () => {
  it("extracts refs and dedupes issuer/owner duplicate entries", () => {
    const refs = parseCurrentFeed(SAMPLE_FEED);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({
      accessionNo: "0000320193-26-000123",
      cik: "0000320193",
      formType: "4",
      filedAt: "2026-07-31T17:05:14-04:00",
      sourceUrl:
        "https://www.sec.gov/Archives/edgar/data/320193/000032019326000123/0000320193-26-000123-index.htm",
    });
    expect(refs[1]!.formType).toBe("4/A");
  });

  it("returns empty for an empty feed", () => {
    expect(parseCurrentFeed("<feed></feed>")).toEqual([]);
  });
});

const SAMPLE_IDX = `Description:           Daily Index of EDGAR Dissemination Feed by Form Type
Last Data Received:    July 31, 2026

Form Type   Company Name                                                  CIK         Date Filed  File Name
---------------------------------------------------------------------------------------------------------------
10-K        WIDGET CORP                                                   1111111     20260731    edgar/data/1111111/0001111111-26-000001.txt
4           Apple Inc.                                                    320193      20260731    edgar/data/320193/0000320193-26-000123.txt
4/A         SMITH ROBERT                                                  9876543     20260731    edgar/data/9876543/0009876543-26-000004.txt
5           OLD MONEY LLC                                                 2222222     20260731    edgar/data/2222222/0002222222-26-000009.txt
3           NEWBIE EXEC                                                   3333333     20260731    edgar/data/3333333/0003333333-26-000002.txt
`;

describe("parseDailyFormIdx", () => {
  it("keeps only requested ownership forms, including amendments", () => {
    const refs = parseDailyFormIdx(SAMPLE_IDX, ["4"]);
    expect(refs.map((r) => r.accessionNo)).toEqual([
      "0000320193-26-000123",
      "0009876543-26-000004",
    ]);
    expect(refs[0]).toEqual({
      accessionNo: "0000320193-26-000123",
      cik: "0000320193",
      formType: "4",
      filedAt: "2026-07-31",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/0000320193-26-000123.txt",
    });
  });

  it("supports multiple forms", () => {
    const refs = parseDailyFormIdx(SAMPLE_IDX, ["3", "4", "5"]);
    expect(refs).toHaveLength(4);
  });
});

describe("URL builders", () => {
  it("builds the current-feed URL", () => {
    expect(edgarCurrentFeedUrl("4")).toContain("action=getcurrent&type=4");
    expect(edgarCurrentFeedUrl("4")).toContain("output=atom");
  });

  it("builds the submission text URL from any associated CIK", () => {
    expect(edgarSubmissionTextUrl("0000320193", "000032019326000123")).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/0000320193-26-000123.txt",
    );
  });

  it("builds the daily form index URL with the right quarter", () => {
    expect(edgarDailyFormIdxUrl(new Date(Date.UTC(2026, 6, 31)))).toBe(
      "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR3/form.20260731.idx",
    );
    expect(edgarDailyFormIdxUrl(new Date(Date.UTC(2026, 0, 2)))).toBe(
      "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR1/form.20260102.idx",
    );
  });
});

describe("submission text helpers", () => {
  const txt = wrapAsSubmissionText(SAMPLE_FORM4_XML, "20260731170512");

  it("extracts the embedded ownershipDocument XML", () => {
    const xml = extractOwnershipXml(txt);
    expect(xml).not.toBeNull();
    expect(xml!.startsWith("<ownershipDocument")).toBe(true);
    expect(xml!.endsWith("</ownershipDocument>")).toBe(true);
  });

  it("returns null when no ownership document is present", () => {
    expect(extractOwnershipXml("<SEC-DOCUMENT>10-K stuff</SEC-DOCUMENT>")).toBeNull();
  });

  it("converts Eastern acceptance datetimes to UTC (daylight time)", () => {
    // July = EDT (UTC-4): 17:05:12 Eastern -> 21:05:12 UTC
    expect(extractAcceptanceDatetime(txt)).toBe("2026-07-31T21:05:12.000Z");
  });

  it("converts Eastern acceptance datetimes to UTC (standard time)", () => {
    // January = EST (UTC-5): 12:00:00 Eastern -> 17:00:00 UTC
    const winter = wrapAsSubmissionText(SAMPLE_FORM4_XML, "20260115120000");
    expect(extractAcceptanceDatetime(winter)).toBe("2026-01-15T17:00:00.000Z");
  });
});
