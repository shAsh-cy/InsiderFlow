import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";

import type { TradeRow } from "./queries";
import { buildRssFeed, escapeXml } from "./rss";

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
});
