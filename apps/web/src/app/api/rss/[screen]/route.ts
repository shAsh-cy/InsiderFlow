import { ApiError, CACHE_POLICIES, handleApi } from "@/lib/api/http";
import { queryTrades } from "@/lib/api/queries";
import { buildRssFeed } from "@/lib/api/rss";
import { isScreenerPreset, SCREENER_PRESETS, tradesQuerySchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ screen: string }> },
): Promise<Response> {
  return handleApi(req, CACHE_POLICIES.rss, async () => {
    const { screen } = await params;
    const preset = isScreenerPreset(screen) ? SCREENER_PRESETS[screen] : undefined;
    if (!preset) {
      throw new ApiError(
        404,
        `Unknown screen. Available: ${Object.keys(SCREENER_PRESETS).join(", ")}`,
      );
    }
    const url = new URL(req.url);
    const query = {
      ...tradesQuerySchema.parse({}),
      ...preset.params,
      limit: 50,
    };
    const { data } = await queryTrades(getDb(), query);
    const xml = buildRssFeed({
      title: `InsiderFlow — ${screen}`,
      description: `${preset.description}. Research/education only — not investment advice.`,
      siteUrl: url.origin,
      selfUrl: url.origin + url.pathname,
      items: data,
    });
    return { body: xml, contentType: "application/rss+xml; charset=utf-8" };
  });
}
