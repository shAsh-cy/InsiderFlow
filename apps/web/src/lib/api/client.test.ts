import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, fetchAllPages, fetchTrades, nextPageParams } from "./client";
import type { PageMeta } from "./queries";

const meta = (overrides: Partial<PageMeta> = {}): PageMeta => ({
  limit: 50,
  offset: 0,
  count: 1,
  hasMore: false,
  nextOffset: null,
  ...overrides,
});

function mockFetchOnce(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchTrades", () => {
  it("builds query strings, skipping undefined params, and parses the envelope", async () => {
    const mock = mockFetchOnce(200, {
      data: [{ id: "t1" }],
      meta: meta(),
    });
    const page = await fetchTrades({
      relevance: "opportunistic",
      min_value_usd: 250_000,
      ticker: undefined,
      limit: 10,
    });
    const url = String(mock.mock.calls[0]![0]);
    expect(url).toBe("/api/trades?relevance=opportunistic&min_value_usd=250000&limit=10");
    expect(page.data).toHaveLength(1);
    expect(page.meta.hasMore).toBe(false);
  });

  it("throws a typed error carrying the server's message", async () => {
    mockFetchOnce(429, { error: { code: "rate_limited", message: "Rate limit exceeded" } });
    await expect(fetchTrades()).rejects.toMatchObject({
      name: "ApiClientError",
      status: 429,
      message: "Rate limit exceeded",
    });
  });

  it("rejects malformed envelopes", async () => {
    mockFetchOnce(200, { data: [], meta: { nope: true } });
    await expect(fetchTrades()).rejects.toThrow(); // zod refuses the meta shape
  });

  it("exposes ApiClientError for instanceof checks", async () => {
    mockFetchOnce(404, { error: { message: "No company with ticker X" } });
    try {
      await fetchTrades();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);
    }
  });
});

describe("pagination helpers", () => {
  it("nextPageParams advances by nextOffset and stops at the end", () => {
    expect(
      nextPageParams({ limit: 50, offset: 0 }, meta({ hasMore: true, nextOffset: 50 })),
    ).toEqual({ limit: 50, offset: 50 });
    expect(nextPageParams({ limit: 50, offset: 0 }, meta())).toBeNull();
  });

  it("fetchAllPages drains pages until hasMore is false", async () => {
    const pages = [
      { data: [1, 2], meta: meta({ count: 2, hasMore: true, nextOffset: 2 }) },
      { data: [3], meta: meta({ offset: 2, count: 1 }) },
    ];
    const fetcher = vi
      .fn()
      .mockImplementation(() => Promise.resolve(pages[fetcher.mock.calls.length - 1]));
    const all = await fetchAllPages(fetcher, { limit: 2 });
    expect(all).toEqual([1, 2, 3]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith({ limit: 2, offset: 2 });
  });
});
