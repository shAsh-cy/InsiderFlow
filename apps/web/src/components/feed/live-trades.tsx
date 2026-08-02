"use client";

/**
 * The live fold of /trades: server-seeded rows + SSE arrivals on top,
 * filtered client-side with the same semantics as the URL filters.
 * Survives the ~25s SSE window closes untouched (hook contract).
 */
import dynamic from "next/dynamic";
import { useMemo } from "react";

import { LiveDot } from "@/components/domain/live-dot";
import { StaticFeedRow } from "@/components/domain/static-feed-row";
import { useTradeStream } from "@/hooks/use-trade-stream";
import type { TradeRow } from "@/lib/api/queries";
import { matchesTradeFilters } from "@/lib/api/trade-filter";
import type { ClientTradeFilters } from "@/lib/api/trade-filter";

const LiveFeedRow = dynamic(
  () => import("@/components/domain/live-feed-row").then((m) => m.LiveFeedRow),
  { ssr: false, loading: () => null },
);

export function LiveTrades({
  initialTrades,
  filters,
  limit = 8,
}: {
  initialTrades: TradeRow[];
  filters: ClientTradeFilters;
  limit?: number;
}) {
  const { trades, status } = useTradeStream({ maxItems: 20 });

  const rows = useMemo(() => {
    const streamed = trades.filter((t) => matchesTradeFilters(t, filters));
    const streamedIds = new Set(streamed.map((t) => t.id));
    const merged: Array<{ trade: TradeRow; streamed: boolean }> = [
      ...streamed.map((trade) => ({ trade, streamed: true })),
      ...initialTrades
        .filter((t) => !streamedIds.has(t.id))
        .map((trade) => ({ trade, streamed: false })),
    ];
    return merged.slice(0, limit);
  }, [trades, initialTrades, filters, limit]);

  return (
    <section aria-label="Live trades" data-testid="live-fold">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Live
        </h2>
        <LiveDot status={status} />
      </div>
      {rows.length === 0 ? (
        <p className="glass rounded-lg px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing matches these filters yet — new trades stream in the moment they are ingested.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
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
