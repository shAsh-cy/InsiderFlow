import { companies, eq } from "@insiderflow/db";

import { ApiError, CACHE_POLICIES, handleApi } from "@/lib/api/http";
import {
  queryCompanyStats,
  queryPriceContext,
  querySentiment,
  queryTrades,
} from "@/lib/api/queries";
import { tickerParamSchema, tradesQuerySchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ ticker: string }> },
): Promise<Response> {
  return handleApi(req, CACHE_POLICIES.company, async () => {
    const ticker = tickerParamSchema.parse((await params).ticker);
    const db = getDb();

    const [company] = await db.select().from(companies).where(eq(companies.ticker, ticker));
    if (!company) throw new ApiError(404, `No company with ticker ${ticker}`);

    const [stats, recentTrades, sentiment, priceContext] = await Promise.all([
      queryCompanyStats(db, company.id),
      queryTrades(db, { ...tradesQuerySchema.parse({}), ticker, limit: 10 }),
      querySentiment(db, ticker),
      queryPriceContext(db, company.id),
    ]);

    return {
      json: {
        data: {
          id: company.id,
          ticker: company.ticker,
          name: company.name,
          country: company.country,
          exchange: company.exchange,
          sector: company.sector,
          cik: company.cik,
          stats90d: stats,
          /** Finnhub monthly share purchase ratio, when the worker tracks this symbol. */
          insiderSentiment: sentiment.length > 0 ? sentiment : null,
          /** Trade price vs that day's close for recent priced trades. */
          priceContext,
          recentTrades: recentTrades.data,
        },
      },
    };
  });
}
