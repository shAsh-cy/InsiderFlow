import { formatAmountBracket } from "@insiderflow/core";

import type { PoliticianTradeRow } from "./analytics-queries";
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

/**
 * A disclosed AMOUNT BRACKET, rendered honestly — delegates to the single
 * formatter in @insiderflow/core so the feed can never drift from the UI.
 */
export function formatAmountRange(min: number | null, max: number | null): string {
  return formatAmountBracket(min, max);
}

export function politicianTradeToRssItem(trade: PoliticianTradeRow): {
  title: string;
  description: string;
} {
  const verb =
    trade.direction === "buy" ? "bought" : trade.direction === "sell" ? "sold" : "exchanged";
  const symbol = trade.ticker ?? trade.assetDescription;
  const amount = trade.amountRange ?? formatAmountRange(trade.amountMin, trade.amountMax);
  const who = `${trade.politician.name} (${trade.politician.chamber}${
    trade.politician.party ? `-${trade.politician.party}` : ""
  }${trade.politician.state ? `, ${trade.politician.state}` : ""})`;

  const bits = [
    `${who} ${verb} ${symbol} on ${trade.txnDate}`,
    `Disclosed ${trade.disclosedAt ?? "date unknown"}`,
    trade.disclosureLagDays !== null ? `${trade.disclosureLagDays} days after the trade` : null,
    trade.late ? "— past the 45-day STOCK Act deadline" : null,
    `Amount: ${amount} (disclosed as a range; filings contain no exact figure)`,
    trade.owner ? `Held: ${trade.owner}` : null,
  ].filter(Boolean);

  return {
    title: `[${trade.politician.chamber}] ${symbol} — ${trade.politician.name} ${verb} (${amount})`,
    description: `${bits.join(". ")}. Not investment advice.`,
  };
}

export interface RssItem {
  id: string;
  title: string;
  description: string;
  link: string;
  pubDate: string;
}

export interface RssFeedOptions {
  title: string;
  description: string;
  siteUrl: string;
  selfUrl: string;
  items: TradeRow[];
}

function renderFeed({
  title,
  description,
  siteUrl,
  selfUrl,
  items,
}: Omit<RssFeedOptions, "items"> & { items: RssItem[] }): string {
  const lastBuildDate = new Date(items.length > 0 ? items[0]!.pubDate : Date.now()).toUTCString();

  const itemXml = items
    .map((item) =>
      [
        "    <item>",
        `      <title>${escapeXml(item.title)}</title>`,
        `      <link>${escapeXml(item.link)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(item.id)}</guid>`,
        `      <pubDate>${new Date(item.pubDate).toUTCString()}</pubDate>`,
        `      <description>${escapeXml(item.description)}</description>`,
        "    </item>",
      ].join("\n"),
    )
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

/** RSS 2.0 with the atom:link self reference required by validators. */
export function buildRssFeed(options: RssFeedOptions): string {
  return renderFeed({
    ...options,
    items: options.items.map((trade) => {
      const { title, description } = tradeToRssItem(trade);
      return {
        id: trade.id,
        title,
        description,
        link: trade.filing?.sourceUrl ?? options.siteUrl,
        pubDate: trade.createdAt,
      };
    }),
  });
}

/** The congressional-disclosure feed. Links straight to the filed PTR PDF. */
export function buildPoliticianRssFeed(
  options: Omit<RssFeedOptions, "items"> & { items: PoliticianTradeRow[] },
): string {
  return renderFeed({
    ...options,
    items: options.items.map((trade) => {
      const { title, description } = politicianTradeToRssItem(trade);
      return {
        id: trade.id,
        title,
        description,
        link: trade.sourceUrl ?? `${options.siteUrl}/politicians`,
        pubDate: trade.createdAt,
      };
    }),
  });
}
