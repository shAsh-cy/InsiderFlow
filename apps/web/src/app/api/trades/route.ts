import { CACHE_POLICIES, handleApi, searchParamsToObject } from "@/lib/api/http";
import { queryTrades } from "@/lib/api/queries";
import { tradesQuerySchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";

export async function GET(req: Request): Promise<Response> {
  return handleApi(req, CACHE_POLICIES.trades, async () => {
    const query = tradesQuerySchema.parse(searchParamsToObject(new URL(req.url).searchParams));
    return { json: await queryTrades(getDb(), query) };
  });
}
