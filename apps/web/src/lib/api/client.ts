/**
 * Typed, client-safe API client for the public InsiderFlow API.
 * Mirrors the OpenAPI spec: every list endpoint returns a { data, meta }
 * envelope with limit/offset/count/hasMore/nextOffset. Meta is validated
 * with zod; row payloads are typed via the server's own row types
 * (type-only imports — nothing server-side leaks into the client bundle).
 */
import { z } from "zod";

import type { HeatmapCell, PageMeta, SentimentPoint, TradeRow } from "./queries";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export const pageMetaSchema = z.object({
  limit: z.number().int(),
  offset: z.number().int(),
  count: z.number().int(),
  hasMore: z.boolean(),
  nextOffset: z.number().int().nullable(),
});

const envelopeSchema = z.object({
  data: z.unknown(),
  meta: z.unknown().optional(),
});

export interface Paged<T> {
  data: T[];
  meta: PageMeta;
}

export interface TradesParams {
  market?: string;
  ticker?: string;
  code?: string;
  role?: "director" | "officer" | "ten_pct";
  relevance?: "routine" | "opportunistic";
  source?: string;
  insider_id?: string;
  min_value?: number;
  min_value_usd?: number;
  cluster?: boolean;
  dip?: boolean;
  exec_only?: boolean;
  include_superseded?: boolean;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  sort?: "txn_date" | "value" | "value_usd" | "created_at";
  order?: "asc" | "desc";
}

function toQuery(params: Record<string, unknown> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: "application/json" },
    ...init,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null
        ? ((body as { error?: { message?: string } }).error?.message ?? response.statusText)
        : response.statusText;
    throw new ApiClientError(response.status, message);
  }
  return body as T;
}

async function apiGetPaged<T>(path: string): Promise<Paged<T>> {
  const raw = await apiGet<unknown>(path);
  const envelope = envelopeSchema.parse(raw);
  const meta = pageMetaSchema.passthrough().parse(envelope.meta) as PageMeta;
  return { data: (envelope.data as T[]) ?? [], meta };
}

export function fetchTrades(params: TradesParams = {}): Promise<Paged<TradeRow>> {
  return apiGetPaged<TradeRow>(`/api/trades${toQuery(params as Record<string, unknown>)}`);
}

export function fetchScreener(
  preset: string,
  params: Pick<TradesParams, "limit" | "offset"> = {},
): Promise<Paged<TradeRow>> {
  return apiGetPaged<TradeRow>(
    `/api/screener/${encodeURIComponent(preset)}${toQuery(params as Record<string, unknown>)}`,
  );
}

export interface CompanyDetail {
  id: string;
  ticker: string | null;
  name: string;
  country: string;
  exchange: string | null;
  sector: string | null;
  cik: string | null;
  stats90d: {
    trades: number;
    buyValueUsd: number;
    sellValueUsd: number;
    netValueUsd: number;
    opportunisticTrades: number;
  };
  insiderSentiment: SentimentPoint[] | null;
  priceContext: Array<{ txnDate: string; tradePrice: number; close: number; diffPct: number }>;
  recentTrades: TradeRow[];
}

export async function fetchCompany(ticker: string): Promise<CompanyDetail> {
  const raw = await apiGet<{ data: CompanyDetail }>(`/api/companies/${encodeURIComponent(ticker)}`);
  return raw.data;
}

export async function fetchCompanySentiment(ticker: string): Promise<SentimentPoint[]> {
  const raw = await apiGet<{ data: SentimentPoint[] }>(
    `/api/companies/${encodeURIComponent(ticker)}/sentiment`,
  );
  return raw.data ?? [];
}

export interface InsiderDetail {
  id: string;
  name: string;
  cik: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPctOwner: boolean;
  officerTitle: string | null;
  recentTrades: TradeRow[];
}

export async function fetchInsider(id: string): Promise<InsiderDetail> {
  const raw = await apiGet<{ data: InsiderDetail }>(`/api/insiders/${encodeURIComponent(id)}`);
  return raw.data;
}

export async function fetchHeatmap(
  params: { days?: number; market?: string; relevance?: string; limit?: number } = {},
): Promise<HeatmapCell[]> {
  const raw = await apiGet<{ data: HeatmapCell[] }>(
    `/api/heatmap${toQuery(params as Record<string, unknown>)}`,
  );
  return raw.data ?? [];
}

/** Params for the page after `meta`, or null when the listing is exhausted. */
export function nextPageParams<P extends { offset?: number }>(params: P, meta: PageMeta): P | null {
  if (!meta.hasMore || meta.nextOffset === null) return null;
  return { ...params, offset: meta.nextOffset };
}

/** Drain up to `maxPages` pages of a paged fetcher into one array. */
export async function fetchAllPages<T, P extends { offset?: number }>(
  fetcher: (params: P) => Promise<Paged<T>>,
  params: P,
  maxPages = 5,
): Promise<T[]> {
  const out: T[] = [];
  let current: P | null = params;
  for (let page = 0; page < maxPages && current; page++) {
    const result: Paged<T> = await fetcher(current);
    out.push(...result.data);
    current = nextPageParams(current, result.meta);
  }
  return out;
}
