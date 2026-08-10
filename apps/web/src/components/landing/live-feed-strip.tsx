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
import { SectionHeader } from "@/components/domain/section-header";
import { StaticFeedRow } from "@/components/domain/static-feed-row";
import { TapeList } from "@/components/feed/tape-list";
import { useIdle } from "@/hooks/use-idle";
import { useTradeStream } from "@/hooks/use-trade-stream";
import type { TradeRow } from "@/lib/api/queries";
import { utcClock } from "@/lib/format";

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
  /*
   * The stream opens once the browser has a spare moment or the reader
   * touches the page, not during hydration.
   *
   * The rows on screen are server-rendered — the stream is what keeps them
   * CURRENT, not what puts them there — so nothing a reader can see waits
   * on this. Opening an EventSource inside the hydration window spends
   * main-thread time, at 4x CPU throttling, on a connection nobody is
   * waiting for; deferring it takes that out of the critical path and
   * changes nothing about what the page shows.
   */
  const started = useIdle();
  const { trades, status } = useTradeStream({ maxItems: limit, enabled: started });
  /**
   * Whether the stream is actually up.
   *
   * The indicator used to mount immediately reading "Connecting", which
   * was a claim that a connection was being attempted while it was in fact
   * deliberately deferred — the tape was telling the reader about an
   * intention rather than a state. Until the stream attaches, the "as of"
   * stamp is the honest thing to show: these rows are a snapshot, and it
   * says when they were taken.
   */
  const attached = started && status !== "connecting";

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

  /**
   * The most recent arrival the strip is actually showing.
   *
   * Taken from the rows rather than passed in, so it stays true as SSE
   * delivers: the moment a filing streams in, the stamp moves with it.
   * The landing tape is unfiltered, so the newest row it holds IS the
   * newest row the ingester wrote.
   */
  const latestIngestAt = useMemo(
    () =>
      rows.reduce<string | null>(
        (newest, { trade }) =>
          newest === null || trade.createdAt > newest ? trade.createdAt : newest,
        null,
      ),
    [rows],
  );

  return (
    <section aria-label="Live insider trades" className="w-full">
      {/* h2, not h3: on the landing this strip is a top-level section
          sitting directly under the h1, and jumping to h3 would skip a
          level for anyone navigating by headings. */}
      <SectionHeader
        label={label}
        className="mb-2 border-b border-border pb-2"
        meta={
          <>
            {/* The newest row's own arrival time — the real latest
                ingest, not the render time. A live dot says the
                connection is up, which is not the same claim as "there
                is recent data", and a tape that has been silent for a
                day should say so. */}
            {latestIngestAt ? (
              <span
                className="num"
                title={new Date(latestIngestAt).toUTCString()}
                data-testid="tape-as-of"
              >
                as of {utcClock(latestIngestAt)}
              </span>
            ) : null}
            {/* The slot holds its width whether or not the dot is in it,
                so the upgrade from snapshot to live stream moves nothing.
                The meta row is right-aligned: without a reserved box the
                "as of" stamp slides left the moment the indicator mounts,
                and again when "Connecting" becomes "Live". */}
            <span
              data-testid="tape-live-slot"
              className="inline-flex min-w-16 shrink-0 justify-end"
            >
              {attached ? <LiveDot status={status} /> : null}
            </span>
          </>
        }
      />
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
