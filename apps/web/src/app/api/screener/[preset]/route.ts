import { ApiError, CACHE_POLICIES, handleApi, searchParamsToObject } from "@/lib/api/http";
import { queryTrades } from "@/lib/api/queries";
import { isScreenerPreset, SCREENER_PRESETS, tradesQuerySchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ preset: string }> },
): Promise<Response> {
  return handleApi(req, CACHE_POLICIES.screener, async () => {
    const { preset: presetName } = await params;
    const preset = isScreenerPreset(presetName) ? SCREENER_PRESETS[presetName] : undefined;
    if (!preset) {
      throw new ApiError(
        404,
        `Unknown screener preset. Available: ${Object.keys(SCREENER_PRESETS).join(", ")}`,
      );
    }
    // User filters compose with the preset; the preset wins on conflicts.
    const base = tradesQuerySchema.parse(searchParamsToObject(new URL(req.url).searchParams));
    const result = await queryTrades(getDb(), { ...base, ...preset.params });
    return {
      json: {
        ...result,
        meta: { ...result.meta, preset: presetName, description: preset.description },
      },
    };
  });
}
