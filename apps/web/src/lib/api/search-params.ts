import type { TradesParams } from "./client";
import { tradesQuerySchema } from "./schemas";
import type { TradesQuery } from "./schemas";

export type NextSearchParams = Promise<Record<string, string | string[] | undefined>>;

export function flattenSearchParams(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) flat[key] = first;
  }
  return flat;
}

/**
 * Parse a page's searchParams through the SAME zod schema the API uses.
 * Invalid values degrade to defaults rather than crashing the page — a
 * shared link with a stale param still renders.
 */
export async function parseTradeSearchParams(searchParams: NextSearchParams): Promise<TradesQuery> {
  const flat = flattenSearchParams(await searchParams);
  const parsed = tradesQuerySchema.safeParse(flat);
  return parsed.success ? parsed.data : tradesQuerySchema.parse({});
}

/** The parsed query, minus paging defaults, as typed-client params for follow-up fetches. */
export function toClientParams(query: TradesQuery): TradesParams {
  const rest: Partial<TradesQuery> = { ...query };
  delete rest.offset;
  return rest as TradesParams;
}
