import { queryPoliticianTrades } from "@/lib/api/analytics-queries";
import { CACHE_POLICIES, handleApi, searchParamsToObject } from "@/lib/api/http";
import { politiciansQuerySchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";

/**
 * Congressional trading (STOCK Act periodic transaction reports).
 *
 * This shipped in Phase 4 as a typed placeholder returning an empty `data`
 * array plus a `note`. The response CONTRACT is unchanged — `data` and `meta`
 * have the same shape and the same names, and `note` is still present — so a
 * client written against the placeholder keeps working; it just starts
 * receiving rows.
 *
 * AMOUNTS ARE RANGES. `amountMin` / `amountMax` come straight from the
 * disclosed bracket and either may be null (the top bracket is open-ended).
 * There is deliberately no single `value` field: the filing does not contain
 * one, and inventing a midpoint would be fabricating data.
 */
export async function GET(req: Request): Promise<Response> {
  return handleApi(req, CACHE_POLICIES.politicians, async () => {
    const query = politiciansQuerySchema.parse(searchParamsToObject(new URL(req.url).searchParams));
    const { data, meta } = await queryPoliticianTrades(getDb(), query);
    return {
      json: {
        data,
        meta,
        note: "Amounts are the disclosed STOCK Act brackets (amountMin/amountMax); filings contain no exact figure. PTRs are due within 45 days of a transaction over $1,000, so txnDate may precede disclosedAt by weeks. Research/education only — not investment advice.",
      },
    };
  });
}
