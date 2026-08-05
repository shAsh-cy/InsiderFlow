import { queryPoliticianTrades } from "@/lib/api/analytics-queries";
import { CACHE_POLICIES, handleApi, searchParamsToObject } from "@/lib/api/http";
import { buildPoliticianRssFeed } from "@/lib/api/rss";
import { politiciansQuerySchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";

/**
 * RSS for congressional disclosures. Accepts the same filters as
 * /api/politicians, so a reader can subscribe to one filer, one ticker, or
 * only the late filings:
 *
 *   /api/rss/politicians?chamber=senate
 *   /api/rss/politicians?ticker=NVDA
 *   /api/rss/politicians?late_only=true
 *
 * Sorted by disclosure date — a PTR filed today for a 40-day-old trade is
 * news today, so ordering by transaction date would bury it.
 */
export async function GET(req: Request): Promise<Response> {
  return handleApi(req, CACHE_POLICIES.rss, async () => {
    const url = new URL(req.url);
    const query = politiciansQuerySchema.parse({
      ...searchParamsToObject(url.searchParams),
      limit: "50",
    });
    const { data } = await queryPoliticianTrades(getDb(), query);

    const scope = [
      query.chamber ? `${query.chamber} ` : "",
      query.ticker ? `${query.ticker} ` : "",
      query.late_only ? "late " : "",
    ].join("");

    const xml = buildPoliticianRssFeed({
      title: `InsiderFlow — ${scope}congressional disclosures`.replace(/\s+/g, " "),
      description:
        "STOCK Act periodic transaction reports. Amounts are disclosed brackets, never exact figures. Research/education only — not investment advice.",
      siteUrl: url.origin,
      selfUrl: url.origin + url.pathname + (url.search || ""),
      items: data,
    });
    return { body: xml, contentType: "application/rss+xml; charset=utf-8" };
  });
}
