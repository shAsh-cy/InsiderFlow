import { CACHE_POLICIES, handleApi, searchParamsToObject } from "@/lib/api/http";
import { queryHeatmap } from "@/lib/api/queries";
import { heatmapQuerySchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";

export async function GET(req: Request): Promise<Response> {
  return handleApi(req, CACHE_POLICIES.heatmap, async () => {
    const query = heatmapQuerySchema.parse(searchParamsToObject(new URL(req.url).searchParams));
    const cells = await queryHeatmap(getDb(), query);
    return { json: { data: cells, meta: { days: query.days, count: cells.length } } };
  });
}
