"use client";

/**
 * Client wrapper that code-splits Recharts: neither chart's runtime is in
 * the page's critical path — skeletons hold layout until the chunk lands.
 */
import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import type { NetFlowPoint } from "@/lib/api/page-queries";
import type { SentimentPoint } from "@/lib/api/queries";

const NetFlowChart = dynamic(() => import("./net-flow-chart"), {
  ssr: false,
  loading: () => <Skeleton className="h-[220px] w-full rounded-lg bg-white/4" />,
});
const SentimentSpark = dynamic(() => import("./sentiment-spark"), {
  ssr: false,
  loading: () => <Skeleton className="h-[88px] w-full rounded-lg bg-white/4" />,
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
      <section aria-label="Insider flow" className="glass rounded-xl p-4 lg:col-span-2">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Net insider flow
        </h2>
        {netFlow.length === 0 ? (
          <p className="py-16 text-center text-sm text-subtle-foreground">
            No priced trades to chart yet.
          </p>
        ) : (
          <NetFlowChart data={netFlow} />
        )}
      </section>
      <section aria-label="Insider sentiment" className="glass rounded-xl p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            MSPR sentiment
          </h2>
          {latestMspr !== null ? (
            <span className="tnum text-sm font-semibold text-foreground">
              {latestMspr.toFixed(1)}
            </span>
          ) : null}
        </div>
        {sentiment.length === 0 ? (
          <p className="py-8 text-center text-xs leading-relaxed text-subtle-foreground">
            Not tracked — MSPR appears for symbols on the ingestion watchlist with Finnhub
            configured.
          </p>
        ) : (
          <>
            <SentimentSpark points={sentiment} />
            <p className="text-2xs mt-2 text-subtle-foreground">
              Monthly share purchase ratio, −100 (all selling) to +100 (all buying).
            </p>
          </>
        )}
      </section>
    </div>
  );
}
