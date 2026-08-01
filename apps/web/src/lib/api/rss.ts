import type { TradeRow } from "./queries";

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const money = (n: number | null, currency: string): string =>
  n === null ? "undisclosed value" : `${currency} ${Math.round(n).toLocaleString("en-US")}`;

const shares = (n: number | null): string =>
  n === null ? "an undisclosed number of" : n.toLocaleString("en-US");

export function tradeToRssItem(trade: TradeRow): { title: string; description: string } {
  const verb =
    trade.direction === "buy" ? "acquired" : trade.direction === "sell" ? "disposed of" : "moved";
  const symbol = trade.company.ticker ?? trade.company.name;
  const title = `[${trade.code}] ${symbol} — ${trade.insider.name} ${verb} ${shares(
    trade.shares,
  )} shares (${money(trade.value, trade.currency)})`;
  const bits = [
    `${trade.insider.name}${trade.insider.title ? ` (${trade.insider.title})` : ""}`,
    `${verb} ${shares(trade.shares)} shares of ${trade.company.name}`,
    `on ${trade.txnDate}`,
    trade.price !== null ? `at ${trade.currency} ${trade.price}` : null,
    trade.is10b51 ? "under a Rule 10b5-1 plan" : null,
    `[${trade.relevance}]`,
    `via ${trade.source}`,
  ].filter(Boolean);
  return { title, description: `${bits.join(" ")}. Not investment advice.` };
}

export interface RssFeedOptions {
  title: string;
  description: string;
  siteUrl: string;
  selfUrl: string;
  items: TradeRow[];
}

/** RSS 2.0 with the atom:link self reference required by validators. */
export function buildRssFeed({
  title,
  description,
  siteUrl,
  selfUrl,
  items,
}: RssFeedOptions): string {
  const lastBuildDate = new Date(items.length > 0 ? items[0]!.createdAt : Date.now()).toUTCString();

  const itemXml = items
    .map((trade) => {
      const { title: itemTitle, description: itemDescription } = tradeToRssItem(trade);
      const link = trade.filing?.sourceUrl ?? siteUrl;
      return [
        "    <item>",
        `      <title>${escapeXml(itemTitle)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(trade.id)}</guid>`,
        `      <pubDate>${new Date(trade.createdAt).toUTCString()}</pubDate>`,
        `      <description>${escapeXml(itemDescription)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(siteUrl)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    "    <language>en-us</language>",
    `    <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    "    <ttl>5</ttl>",
    `    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml"/>`,
    itemXml,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
