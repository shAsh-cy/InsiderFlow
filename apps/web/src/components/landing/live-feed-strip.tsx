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
}: {
  initialTrades: TradeRow[];
  limit?: number;
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
    <section aria-label="Live insider trades" className="mx-auto w-full max-w-3xl px-4 sm:px-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Live tape
        </h2>
        <LiveDot status={status} />
      </div>
      {rows.length === 0 ? (
        <p className="glass rounded-lg px-4 py-6 text-center text-sm text-muted-foreground">
          Listening for filings — new trades appear here the moment they are ingested.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="live-feed">
          {rows.map(({ trade, streamed }) =>
            streamed ? (
              <LiveFeedRow key={trade.id} trade={trade} />
            ) : (
              <StaticFeedRow key={trade.id} trade={trade} />
            ),
          )}
        </ul>
      )}
    </section>
  );
}
