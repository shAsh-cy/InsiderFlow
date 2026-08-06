"use client";

/**
 * Infinite-scroll history below the live fold. Pagination follows
 * meta.nextOffset/hasMore via the typed API client; rows are window-
 * virtualized so the DOM stays bounded no matter how far you scroll.
 */
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { StaticFeedRow } from "@/components/domain/static-feed-row";
import { fetchTrades } from "@/lib/api/client";
import type { Paged, TradesParams } from "@/lib/api/client";
import type { PageMeta, TradeRow } from "@/lib/api/queries";

// px. The tape has no gaps: rows butt against one another and are told
// apart by a single hairline, so the virtualizer's estimate is the whole
// row and nothing has to be subtracted back out.
const ROW_HEIGHT = 44;

export function HistoryFeed({
  initialPage,
  filters,
}: {
  initialPage: Paged<TradeRow>;
  filters: TradesParams;
}) {
  const [rows, setRows] = useState<TradeRow[]>(initialPage.data);
  const [meta, setMeta] = useState<PageMeta>(initialPage.meta);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (loading || !meta.hasMore || meta.nextOffset === null) return;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchTrades({ ...filters, offset: meta.nextOffset });
      setRows((current) => {
        const seen = new Set(current.map((r) => r.id));
        return [...current, ...page.data.filter((r) => !seen.has(r.id))];
      });
      setMeta(page.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more trades");
    } finally {
      setLoading(false);
    }
  }, [loading, meta, filters]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "600px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  return (
    <section aria-label="Trade history" data-testid="history-feed">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-ink-muted">
        History
      </h2>
      {rows.length === 0 ? (
        <p className="surface rounded-lg px-4 py-6 text-center text-sm text-ink-muted">
          No trades match these filters.
        </p>
      ) : (
        // One surface around the whole run of rows. Each row carries only
        // a hairline and a hover ground — no per-row border, shadow or
        // blur, which is what keeps a ten-thousand-row scroll cheap.
        <div ref={listRef} className="surface overflow-hidden rounded-lg">
          <ul
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
            data-testid="history-rows"
          >
            {virtualizer.getVirtualItems().map((item) => {
              const trade = rows[item.index]!;
              return (
                <StaticFeedRow
                  key={trade.id}
                  trade={trade}
                  className="absolute inset-x-0 top-0"
                  style={{
                    height: ROW_HEIGHT,
                    transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
                  }}
                />
              );
            })}
          </ul>
        </div>
      )}
      <div ref={sentinelRef} aria-hidden className="h-2" />
      <div className="flex items-center justify-center py-4 text-xs text-ink-faint">
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading…
          </span>
        ) : error ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            className="underline underline-offset-4"
          >
            {error} — retry
          </button>
        ) : meta.hasMore ? (
          "Scroll for more"
        ) : (
          "End of tape"
        )}
      </div>
    </section>
  );
}
