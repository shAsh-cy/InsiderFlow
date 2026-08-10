"use client";

/**
 * Infinite-scroll history below the live fold. Pagination follows
 * meta.nextOffset/hasMore via the typed API client; rows are window-
 * virtualized so the DOM stays bounded no matter how far you scroll.
 */
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState } from "react";

import { SearchX } from "lucide-react";

import { EmptyState } from "@/components/domain/empty-state";
import { SectionHeader } from "@/components/domain/section-header";
import { RowSkeleton } from "@/components/domain/row-skeleton";
import { StaticFeedRow } from "@/components/domain/static-feed-row";
import { TapeList } from "@/components/feed/tape-list";
import { useTapeRowHeight } from "@/hooks/use-tape-row-height";
import { fetchTrades } from "@/lib/api/client";
import type { Paged, TradesParams } from "@/lib/api/client";
import type { PageMeta, TradeRow } from "@/lib/api/queries";

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

  // The tape has no gaps: rows butt against one another and are told apart
  // by a single hairline, so the estimate is the whole row and nothing has
  // to be subtracted back out. Two lines below 640px, one above.
  const rowHeight = useTapeRowHeight();

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => rowHeight,
    overscan: 12,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  // The estimator is captured at construction, so rotating a phone (or
  // dragging a window across 640px) has to re-run it explicitly or every
  // row below the fold stays positioned for the old height.
  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  return (
    <section aria-label="Trade history" data-testid="history-feed">
      {/* The same header pattern as the live fold above it. It used to be
          a different size, a different colour and a different spacing
          system, which made one page read as two. */}
      <SectionHeader
        label="History"
        className="mb-2 border-b border-border pb-2"
        meta={
          rows.length > 0 ? (
            <span className="num" data-testid="history-count">
              {rows.length.toLocaleString("en-US")}
              {meta.hasMore ? "+" : ""} rows
            </span>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No trades match these filters"
          body="Loosen one, or clear them all — the whole tape is free to read either way."
        />
      ) : (
        // One surface around the whole run of rows. Each row carries only
        // a hairline and a hover ground — no per-row border, shadow or
        // blur, which is what keeps a ten-thousand-row scroll cheap.
        <div ref={listRef} className="surface @container overflow-hidden rounded-lg">
          <TapeList
            label="Trade history — use the arrow keys to move between rows"
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
            testId="history-rows"
          >
            {virtualizer.getVirtualItems().map((item) => {
              const trade = rows[item.index]!;
              return (
                <StaticFeedRow
                  key={trade.id}
                  trade={trade}
                  className="absolute inset-x-0 top-0"
                  style={{
                    height: rowHeight,
                    transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
                  }}
                />
              );
            })}
          </TapeList>
        </div>
      )}
      {/* The next page, drawn at the height it will occupy. A spinner here
          would say "wait"; this says "more tape, arriving" — and it holds
          the scroll position instead of letting the page jump when the
          rows land. */}
      {loading ? (
        <div className="surface @container mt-2 overflow-hidden rounded-lg" aria-busy>
          <RowSkeleton rows={5} height={rowHeight} />
          <span className="sr-only" role="status">
            Loading more trades
          </span>
        </div>
      ) : null}
      <div ref={sentinelRef} aria-hidden className="h-2" />
      <div className="flex items-center justify-center py-4 text-xs text-ink-faint">
        {loading ? null : error ? (
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
