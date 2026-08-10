"use client";

/**
 * Watchlist — localStorage-backed today (see lib/watchlist/store.ts for
 * the Phase 7 Supabase swap point). Client page by nature: the data lives
 * in the browser.
 */
import { Plus, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/domain/empty-state";
import { StaticFeedRow } from "@/components/domain/static-feed-row";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWatchlist } from "@/hooks/use-watchlist";
import { fetchTrades } from "@/lib/api/client";
import type { TradeRow } from "@/lib/api/queries";
import type { WatchlistItem } from "@/lib/watchlist/store";
import { formatCompact } from "@/lib/format";

interface CompanyHit {
  ticker: string | null;
  name: string;
  country: string;
}

function AddCompany() {
  const { add, has } = useWatchlist();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CompanyHit[]>([]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const handle = setTimeout(() => {
      fetch(`/api/companies?q=${encodeURIComponent(query.trim())}&limit=6`)
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((body: { data?: CompanyHit[] }) => setHits(body.data ?? []))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="relative max-w-md">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Add a company — search name or ticker…"
        aria-label="Search companies to watch"
        className="surface h-11 w-full rounded-md px-3 text-sm text-ink outline-none placeholder:text-ink-faint md:h-10"
      />
      {hits.length > 0 ? (
        <ul className="surface-raised absolute inset-x-0 top-11 z-20 overflow-hidden rounded-md">
          {hits
            .filter((hit) => hit.ticker)
            .map((hit) => (
              <li key={hit.ticker} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-fill"
                  onClick={() => {
                    add({
                      kind: "company",
                      refId: hit.ticker!,
                      label: hit.name,
                      market: hit.country,
                    });
                    setQuery("");
                  }}
                >
                  <Plus className="size-3.5 text-ink-faint" aria-hidden />
                  <span className="num text-xs font-semibold text-ink">{hit.ticker}</span>
                  <span className="truncate text-ink-muted">{hit.name}</span>
                  {has("company", hit.ticker!) ? (
                    <Star className="ml-auto size-3 fill-ink text-ink" aria-hidden />
                  ) : null}
                </button>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

function WatchCard({ item, onRemove }: { item: WatchlistItem; onRemove: () => void }) {
  const [trades, setTrades] = useState<TradeRow[] | null>(null);

  useEffect(() => {
    const params = item.kind === "company" ? { ticker: item.refId } : { insider_id: item.refId };
    fetchTrades({ ...params, limit: 4, sort: "created_at", order: "desc" })
      .then((page) => setTrades(page.data))
      .catch(() => setTrades([]));
  }, [item.kind, item.refId]);

  const buys = trades?.filter((t) => t.acquiredDisposed === "A").length ?? 0;
  const sells = trades?.filter((t) => t.acquiredDisposed === "D").length ?? 0;
  const netUsd = (trades ?? []).reduce(
    (sum, t) => sum + (t.valueUsd ?? 0) * (t.acquiredDisposed === "D" ? -1 : 1),
    0,
  );

  return (
    <article className="surface flex flex-col gap-3 rounded-lg p-4">
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <Link
          href={item.kind === "company" ? `/stock/${item.refId}` : `/insider/${item.refId}`}
          className="min-w-0 flex-1 truncate font-semibold tracking-tight text-ink transition-colors hover:text-accent-ink"
        >
          {item.kind === "company" ? <span className="num">{item.refId}</span> : null}{" "}
          <span className="text-sm text-ink-muted">{item.label}</span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Remove ${item.label} from watchlist`}
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </Button>
      </div>

      {trades === null ? (
        <Skeleton className="h-24 w-full rounded-md" />
      ) : trades.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-faint">No recent activity.</p>
      ) : (
        <>
          {/* Direction is spelled out as well as coloured — "buys"/"sells"
              and the sign carry it if the hue does not land. */}
          <p className="num text-2xs text-ink-faint">
            Recent: {buys} buys · {sells} sells · net{" "}
            <span className={netUsd < 0 ? "text-sell-ink" : "text-buy-ink"}>
              <span aria-hidden>{netUsd < 0 ? "▼" : "▲"}</span> {netUsd < 0 ? "−" : ""}$
              {formatCompact(Math.abs(netUsd))}
            </span>
          </p>
          <ul className="surface-sunken @container overflow-hidden rounded-md">
            {trades.map((trade) => (
              <StaticFeedRow key={trade.id} trade={trade} className="px-2.5 py-1.5 text-xs" />
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

export default function WatchlistPage() {
  const { items, remove } = useWatchlist();
  const t = useTranslations("access");

  return (
    <div className="flex flex-col gap-6 pb-24">
      <header className="rail-bleed flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Watchlist</h1>
        <p className="max-w-[68ch] text-sm text-ink-muted">
          Stored in this browser for now — accounts sync it across devices in Phase 7.
        </p>
      </header>

      <AddCompany />

      {items.length === 0 ? (
        // Says what a watchlist is FOR, not just that it is empty — and
        // says the data was already free either way, because a reader who
        // thinks tracking is how you get access never adds anything.
        <EmptyState
          icon={Star}
          title={t("watchlistEmptyTitle")}
          body={
            <>
              {t("watchlistEmptyBody")}{" "}
              <Link
                href="/companies"
                className="text-accent-ink underline decoration-border underline-offset-4 transition-colors hover:decoration-current"
              >
                Browse companies
              </Link>
              .
            </>
          }
        />
      ) : (
        <div
          className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          data-testid="watchlist-items"
        >
          {items.map((item) => (
            <WatchCard key={item.id} item={item} onRemove={() => remove(item.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
