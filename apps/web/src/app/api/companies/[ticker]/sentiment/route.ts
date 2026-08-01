import { CACHE_POLICIES, handleApi } from "@/lib/api/http";
import { querySentiment } from "@/lib/api/queries";
import { tickerParamSchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ ticker: string }> },
): Promise<Response> {
  return handleApi(req, CACHE_POLICIES.sentiment, async () => {
    const ticker = tickerParamSchema.parse((await params).ticker);
    const points = await querySentiment(getDb(), ticker);
    return {
      json: {
        data: points,
        meta: {
          ticker,
          note:
            points.length === 0
              ? "No cached sentiment for this symbol — it is not on the ingestion watchlist (WATCHLIST_SYMBOLS) or Finnhub is not configured."
              : undefined,
        },
      },
    };
  });
}
