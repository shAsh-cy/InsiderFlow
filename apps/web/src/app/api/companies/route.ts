import { z } from "zod";

import { CACHE_POLICIES, handleApi, searchParamsToObject } from "@/lib/api/http";
import { searchCompanies } from "@/lib/api/page-queries";
import { getDb } from "@/lib/db";

const querySchema = z.object({
  q: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Company directory search (pg_trgm) — also powers the watchlist add-flow. */
export async function GET(req: Request): Promise<Response> {
  return handleApi(req, CACHE_POLICIES.company, async () => {
    const { q, limit } = querySchema.parse(searchParamsToObject(new URL(req.url).searchParams));
    const data = await searchCompanies(getDb(), q, limit);
    return { json: { data, meta: { count: data.length, q: q ?? null } } };
  });
}
