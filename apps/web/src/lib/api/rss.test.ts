import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";

import type { PoliticianTradeRow } from "./analytics-queries";
import type { TradeRow } from "./queries";
import { buildPoliticianRssFeed, buildRssFeed, escapeXml, formatAmountRange } from "./rss";
import { SCREENER_PRESETS } from "./schemas";

function fakeTrade(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    source: "edgar",
    market: "US",
    txnDate: "2026-07-30",
    code: "P",
    rawCode: "P",
    direction: "buy",
    relevance: "opportunistic",
    signalWeight: 1,
    shares: 2500,
    price: 226.1,
    value: 565_250,
    currency: "USD",
    priceUsd: 226.1,
    valueUsd: 565_250,
    acquiredDisposed: "A",
    sharesOwnedAfter: 42_500,
    is10b51: false,
    isDerivative: false,
    footnote: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    company: { id: "c1", ticker: "AAPL", name: "Apple Inc." },
    insider: {
      id: "i1",
      name: "DOE JANE A",
      title: "CFO",
      isDirector: true,
      isOfficer: true,
      isTenPctOwner: false,
    },
    filing: {
      accessionNo: "0000320193-26-000123",
      formType: "4",
      filedAt: "2026-07-31T21:05:12.000Z",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/x-index.htm",
      superseded: false,
    },
    ...overrides,
  };
}

describe("escapeXml", () => {
  it("escapes all five XML special characters", () => {
    expect(escapeXml(`<A & B> "quo'te"`)).toBe("&lt;A &amp; B&gt; &quot;quo&apos;te&quot;");
  });
});

describe("buildRssFeed", () => {
  const xml = buildRssFeed({
    title: "InsiderFlow — latest",
    description: "Latest insider trades",
    siteUrl: "https://insiderflow.example",
    selfUrl: "https://insiderflow.example/api/rss/latest",
    items: [
      fakeTrade(),
      fakeTrade({
        id: "99999999-2222-3333-4444-555555555555",
        code: "S",
        direction: "sell",
        company: { id: "c2", ticker: "T&T", name: "Ampersand & Sons <Ltd>" },
      }),
    ],
  });

  it("produces well-formed RSS 2.0 that a strict XML parser accepts", () => {
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(xml) as {
      rss: {
        "@_version": string;
        channel: {
          title: string;
          "atom:link": { "@_rel": string; "@_href": string };
          item: Array<{ title: string; guid: { "#text": string } }>;
        };
      };
    };
    expect(parsed.rss["@_version"]).toBe("2.0");
    expect(parsed.rss.channel.title).toBe("InsiderFlow — latest");
    expect(parsed.rss.channel["atom:link"]["@_rel"]).toBe("self");
    expect(parsed.rss.channel.item).toHaveLength(2);
    expect(parsed.rss.channel.item[0]!.title).toContain("DOE JANE A");
    expect(parsed.rss.channel.item[0]!.title).toContain("AAPL");
  });

  it("escapes markup in company names instead of breaking the feed", () => {
    expect(xml).toContain("Ampersand &amp; Sons &lt;Ltd&gt;");
    expect(xml).not.toContain("<Ltd>");
  });

  it("includes pubDate in RFC 822 format", () => {
    expect(xml).toContain("<pubDate>Sat, 01 Aug 2026 12:00:00 GMT</pubDate>");
  });

  it("builds a valid feed for EVERY screener preset", () => {
    // The acceptance criterion is "every screen has RSS", so this asserts the
    // set rather than spot-checking one preset.
    const parser = new XMLParser({ ignoreAttributes: false });
    for (const [name, preset] of Object.entries(SCREENER_PRESETS)) {
      const feed = buildRssFeed({
        title: `InsiderFlow — ${name}`,
        description: preset.description,
        siteUrl: "https://insiderflow.example",
        selfUrl: `https://insiderflow.example/api/rss/${name}`,
        items: [fakeTrade()],
      });
      const parsed = parser.parse(feed) as { rss: { channel: { title: string } } };
      expect(parsed.rss.channel.title, `preset ${name}`).toBe(`InsiderFlow — ${name}`);
      expect(feed, `preset ${name}`).toContain("Not investment advice");
    }
  });
});

function fakePoliticianTrade(overrides: Partial<PoliticianTradeRow> = {}): PoliticianTradeRow {
  return {
    id: "aaaaaaaa-2222-3333-4444-555555555555",
    politician: {
      id: "p1",
      // Obviously fictional — never a real person in a fixture.
      name: "ZZ Representative Testcase",
      chamber: "house",
      party: "IND",
      state: "ZZ",
      district: "ZZ01",
    },
    ticker: "ZZTEST",
    companyId: null,
    companyName: null,
    assetDescription: "ZZ Test Corporation",
    assetType: "Stock",
    txnType: "purchase",
    direction: "buy",
    txnDate: "2026-07-15",
    disclosedAt: "2026-08-04",
    amountMin: 15_001,
    amountMax: 50_000,
    amountRange: "$15,001 - $50,000",
    disclosureLagDays: 20,
    late: false,
    owner: "joint",
    comment: null,
    source: "house-stock-watcher",
    sourceUrl: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/00000000.pdf",
    createdAt: "2026-08-04T09:00:00.000Z",
    ...overrides,
  };
}

describe("formatAmountRange", () => {
  it("renders an open-ended top bracket with a plus, not a fake maximum", () => {
    expect(formatAmountRange(50_000_000, null)).toBe("$50,000,000+");
  });

  it("never prints a point value for a bracket", () => {
    expect(formatAmountRange(1001, 15_000)).toBe("$1,001–$15,000");
  });

  it("says so when nothing was disclosed", () => {
    expect(formatAmountRange(null, null)).toBe("an undisclosed amount");
  });
});

describe("buildPoliticianRssFeed", () => {
  const feed = buildPoliticianRssFeed({
    title: "InsiderFlow — congressional disclosures",
    description: "STOCK Act periodic transaction reports",
    siteUrl: "https://insiderflow.example",
    selfUrl: "https://insiderflow.example/api/rss/politicians",
    items: [
      fakePoliticianTrade(),
      fakePoliticianTrade({
        id: "bbbbbbbb-2222-3333-4444-555555555555",
        txnType: "sale_full",
        direction: "sell",
        amountMin: 50_000_000,
        amountMax: null,
        amountRange: null,
        disclosureLagDays: 61,
        late: true,
      }),
    ],
  });

  it("is well-formed RSS 2.0", () => {
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(feed) as {
      rss: { "@_version": string; channel: { item: Array<{ title: string }> } };
    };
    expect(parsed.rss["@_version"]).toBe("2.0");
    expect(parsed.rss.channel.item).toHaveLength(2);
  });

  it("states the bracket, and never a synthesised figure", () => {
    expect(feed).toContain("$15,001 - $50,000");
    expect(feed).toContain("$50,000,000+");
    expect(feed).toContain("filings contain no exact figure");
  });

  it("surfaces the disclosure lag and flags late filings", () => {
    expect(feed).toContain("20 days after the trade");
    expect(feed).toContain("past the 45-day STOCK Act deadline");
  });

  it("links each item to the filed PTR", () => {
    expect(feed).toContain("disclosures-clerk.house.gov");
  });
});
