/**
 * BSE provider. Verified live 2026-08-02: AnnSubCategoryGetData works
 * without a cookie dance (browser UA + bseindia.com Origin/Referer are
 * enough), returns announcement METADATA + PDF links — no structured trade
 * numbers — and treats empty date params as "today". Used here as an
 * independent discovery/cross-check trail next to NSE's structured rows.
 */
import {
  BSE_ORIGIN,
  BSE_REFERER,
  bseAnnouncementsUrl,
  bseScripSearchUrl,
  parseBseScripSearch,
} from "@insiderflow/core";
import type { BseAnnouncementRow, BseScripMatch, FetchLike } from "@insiderflow/core";
import type { RateLimiter } from "@insiderflow/edgar-worker/http";

import { BROWSER_UA } from "./session";

export const BSE_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: BSE_REFERER,
  Origin: BSE_ORIGIN,
};

export async function fetchBseAnnouncements(
  fetchFn: FetchLike,
  limiter: RateLimiter,
  opts: { fromYmd?: string; toYmd?: string; page?: number } = {},
): Promise<BseAnnouncementRow[]> {
  await limiter.wait();
  const response = await fetchFn(bseAnnouncementsUrl(opts), { headers: BSE_HEADERS });
  if (!response.ok) {
    throw new Error(`BSE responded ${response.status}`);
  }
  const body = await response.text();
  // Both observed live: `"No Record Found!"` and `{}`.
  if (body.startsWith('"') || body === "{}") return [];
  const payload = JSON.parse(body) as { Table?: BseAnnouncementRow[] };
  return Array.isArray(payload.Table) ? payload.Table : [];
}

/** Resolve an exchange symbol / company name to a BSE scrip code + ISIN. */
export async function resolveBseScrip(
  fetchFn: FetchLike,
  limiter: RateLimiter,
  text: string,
  cache: Map<string, BseScripMatch | null>,
): Promise<BseScripMatch | null> {
  const key = text.trim().toUpperCase();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  await limiter.wait();
  const response = await fetchFn(bseScripSearchUrl(key), { headers: BSE_HEADERS });
  const match = response.ok ? (parseBseScripSearch(await response.text())[0] ?? null) : null;
  cache.set(key, match);
  return match;
}
