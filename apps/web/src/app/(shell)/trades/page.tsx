import { Suspense } from "react";

import { CodeLegend } from "@/components/domain/code-legend";
import { FilterBar } from "@/components/feed/filter-bar";
import { HistoryFeed } from "@/components/feed/history-feed";
import { LiveTrades } from "@/components/feed/live-trades";
import { queryTrades } from "@/lib/api/queries";
import { parseTradeSearchParams, toClientParams } from "@/lib/api/search-params";
import type { NextSearchParams } from "@/lib/api/search-params";
import { getDb } from "@/lib/db";

export const metadata = { title: "Live feed" };

/**
 * Live global tape. Server-renders the first page through the shared query
 * layer (no HTTP self-call); the client layers SSE arrivals on top and
 * paginates history with the typed API client. Filters live in the URL.
 */
export default async function TradesPage({ searchParams }: { searchParams: NextSearchParams }) {
  const query = await parseTradeSearchParams(searchParams);
  const live = {
    ...query,
    sort: "created_at" as const,
    order: "desc" as const,
    limit: 8,
    offset: 0,
  };
  const history = { ...query, limit: 30 };

  const db = getDb();
  const [liveSeed, historyPage] = await Promise.all([
    queryTrades(db, live).catch(() => ({ data: [], meta: null })),
    queryTrades(db, history).catch(() => null),
  ]);

  const filters = toClientParams(query);

  return (
    <div className="flex flex-col gap-8 pb-24">
      <header className="flex flex-col gap-1 border-l-2 border-l-accent pl-5">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Live feed</h1>
        <p className="max-w-[68ch] text-sm text-ink-muted">
          Every normalized insider trade, streaming as it is ingested. Not investment advice.
        </p>
      </header>

      <Suspense>
        <FilterBar />
      </Suspense>
      <CodeLegend />

      <LiveTrades initialTrades={liveSeed.data} filters={filters} />

      {historyPage ? (
        <HistoryFeed
          // Remount when filters change so pagination restarts cleanly.
          key={JSON.stringify(filters)}
          initialPage={historyPage}
          filters={{ ...filters, sort: query.sort, order: query.order, limit: 30 }}
        />
      ) : (
        <p className="surface rounded-lg px-4 py-6 text-center text-sm text-ink-muted">
          History is unavailable right now — the live stream above keeps running.
        </p>
      )}
    </div>
  );
}
