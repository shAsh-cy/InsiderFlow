import { CACHE_POLICIES, handleApi, searchParamsToObject } from "@/lib/api/http";
import { paginationSchema } from "@/lib/api/schemas";

/**
 * Placeholder: congressional trading (Senate/House PTR filings) is a
 * separate ingestion pipeline that is not built yet. The endpoint ships
 * now with the final response shape so clients can integrate against it.
 */
export async function GET(req: Request): Promise<Response> {
  return handleApi(req, CACHE_POLICIES.politicians, async () => {
    const { limit, offset } = paginationSchema.parse(
      searchParamsToObject(new URL(req.url).searchParams),
    );
    return {
      json: {
        data: [],
        meta: { limit, offset, count: 0, hasMore: false, nextOffset: null },
        note: "Politician trading ingestion (Senate/House PTR filings) is planned but not yet implemented.",
      },
    };
  });
}
