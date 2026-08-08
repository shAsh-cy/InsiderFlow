"use client";

/**
 * The landing page's one data-connected element: proves useTradeStream end
 * to end.
 *
 * Initial rows are server-rendered (passed in as `initialTrades`), so the
 * tape is present in the HTML — no fetch waterfall, no skeleton, no layout
 * shift. Trades that genuinely arrive later over SSE animate in on top,
 * and the strip survives the server's ~25s window closes untouched (the
 * hook never clears its buffer on reconnect).
 */
import dynamic from "next/dynamic";
import { useMemo } from "react";

import { LiveDot } from "@/components/domain/live-dot";
import { StaticFeedRow } from "@/components/domain/static-feed-row";
import { TapeList } from "@/components/feed/tape-list";
import { useTradeStream } from "@/hooks/use-trade-stream";
import type { TradeRow } from "@/lib/api/queries";

/** Animated row — code-split so `motion` stays off the critical path. */
const LiveFeedRow = dynamic(
  () => import("@/components/domain/live-feed-row").then((m) => m.LiveFeedRow),
  { ssr: false, loading: () => null },
);

export function LiveFeedStrip({
  initialTrades,
  limit = 6,
  label = "Live tape",
  emptyMessage = "Listening for filings — new trades appear here the moment they are ingested.",
}: {
  initialTrades: TradeRow[];
  limit?: number;
  label?: string;
  emptyMessage?: string;
}) {
  const { trades, status } = useTradeStream({ maxItems: limit });

  /** Live arrivals first, then the server-rendered seed, deduped by id. */
  const rows = useMemo(() => {
    const streamedIds = new Set(trades.map((t) => t.id));
    const merged: Array<{ trade: TradeRow; streamed: boolean }> = [
      ...trades.map((trade) => ({ trade, streamed: true })),
      ...initialTrades
        .filter((trade) => !streamedIds.has(trade.id))
        .map((trade) => ({ trade, streamed: false })),
    ];
    return merged.slice(0, limit);
  }, [trades, initialTrades, limit]);

  return (
    <section aria-label="Live insider trades" className="w-full">
      <div className="mb-2 flex items-baseline justify-between border-b border-border pb-2">
        {/* h2, not h3: on the landing this strip is a top-level section
            sitting directly under the h1, and jumping to h3 would skip a
            level for anyone navigating by headings. */}
        <h2 className="text-2xs font-semibold text-ink-faint">{label}</h2>
        <LiveDot status={status} />
      </div>
      {rows.length === 0 ? (
        <p className="surface rounded-lg px-4 py-6 text-center text-sm text-ink-muted">
          {emptyMessage}
        </p>
      ) : (
        // One surface around the whole run: rows are told apart by a
        // hairline, so the strip reads as a continuous tape rather than a
        // stack of separate cards.
        <div className="surface @container overflow-hidden rounded-lg">
          <TapeList label={label} testId="live-feed">
            {rows.map(({ trade, streamed }) =>
              streamed ? (
                <LiveFeedRow key={trade.id} trade={trade} />
              ) : (
                <StaticFeedRow key={trade.id} trade={trade} />
              ),
            )}
          </TapeList>
        </div>
      )}
    </section>
  );
}
