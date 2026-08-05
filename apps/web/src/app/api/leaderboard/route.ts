import { queryLeaderboard } from "@/lib/api/analytics-queries";
import { CACHE_POLICIES, handleApi, searchParamsToObject } from "@/lib/api/http";
import { leaderboardQuerySchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";

/**
 * Insider performance leaderboard.
 *
 * Every figure is a backward-looking descriptive statistic over public
 * filings, computed by the formulas at /docs/methodology. Returns are excess
 * over SPY and signed by trade direction, so a well-timed sale scores as a
 * win. The composite score is shrunk toward zero by sample size — see the
 * methodology page for why, and for what `minTrades` is protecting against.
 *
 * Not a prediction. Not investment advice.
 */
export async function GET(req: Request): Promise<Response> {
  return handleApi(req, CACHE_POLICIES.leaderboard, async () => {
    const query = leaderboardQuerySchema.parse(searchParamsToObject(new URL(req.url).searchParams));
    const { data, meta } = await queryLeaderboard(getDb(), query);
    return {
      json: {
        data,
        meta: { ...meta, metric: query.metric, minTrades: query.min_trades },
        methodology: "/docs/methodology",
        note: "Informational only. Excess returns are measured against SPY and signed by direction; the composite score is shrunk toward zero by sample size. Not investment advice.",
      },
    };
  });
}
