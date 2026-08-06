"use client";

/**
 * Client wrapper that code-splits Recharts: neither chart's runtime is in
 * the page's critical path — skeletons hold layout until the chunk lands.
 */
import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import type { NetFlowPoint } from "@/lib/api/page-queries";
import type { SentimentPoint } from "@/lib/api/queries";

// Skeletons match the loaded height EXACTLY so nothing reflows on arrival;
// the ground comes from Skeleton itself (`--fill`), not a hardcoded wash.
// 240px = the 220px chart plus its 20px written legend — measuring only
// the chart leaves the caption's height to appear later, which is a real
// (and measurable) layout shift.
const NetFlowChart = dynamic(() => import("./net-flow-chart"), {
  ssr: false,
  loading: () => <Skeleton className="h-[240px] w-full rounded-lg" />,
});
const SentimentSpark = dynamic(() => import("./sentiment-spark"), {
  ssr: false,
  loading: () => <Skeleton className="h-[88px] w-full rounded-lg" />,
});

export function ChartsPanel({
  netFlow,
  sentiment,
}: {
  netFlow: NetFlowPoint[];
  sentiment: SentimentPoint[];
}) {
  const latestMspr = [...sentiment].reverse().find((p) => p.mspr !== null)?.mspr ?? null;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <section aria-label="Insider flow" className="surface rounded-lg p-4 lg:col-span-2">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-ink-muted">
          Net insider flow
        </h2>
        {netFlow.length === 0 ? (
          <p className="py-16 text-center text-sm text-ink-faint">No priced trades to chart yet.</p>
        ) : (
          <NetFlowChart data={netFlow} />
        )}
      </section>
      <section aria-label="Insider sentiment" className="surface rounded-lg p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-muted">
            MSPR sentiment
          </h2>
          {latestMspr !== null ? (
            <span className="num text-sm font-semibold text-ink">{latestMspr.toFixed(1)}</span>
          ) : null}
        </div>
        {sentiment.length === 0 ? (
          <p className="py-8 text-center text-xs leading-relaxed text-ink-faint">
            Not tracked — MSPR appears for symbols on the ingestion watchlist with Finnhub
            configured.
          </p>
        ) : (
          <>
            <SentimentSpark points={sentiment} />
            <p className="text-2xs mt-2 text-ink-faint">
              Monthly share purchase ratio, −100 (all selling) to +100 (all buying).
            </p>
          </>
        )}
      </section>
    </div>
  );
}
