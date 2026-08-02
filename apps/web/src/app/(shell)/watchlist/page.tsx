"use client";

/**
 * Watchlist — localStorage-backed today (see lib/watchlist/store.ts for
 * the Phase 7 Supabase swap point). Client page by nature: the data lives
 * in the browser.
 */
import { Plus, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

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
        className="glass h-10 w-full rounded-lg px-3 text-sm outline-none placeholder:text-subtle-foreground"
      />
      {hits.length > 0 ? (
        <ul className="glass-strong absolute inset-x-0 top-11 z-20 overflow-hidden rounded-lg">
          {hits
            .filter((hit) => hit.ticker)
            .map((hit) => (
              <li key={hit.ticker}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/6"
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
                  <Plus className="size-3.5 text-subtle-foreground" aria-hidden />
                  <span className="font-mono text-xs font-semibold">{hit.ticker}</span>
                  <span className="truncate text-muted-foreground">{hit.name}</span>
                  {has("company", hit.ticker!) ? (
                    <Star className="ml-auto size-3 fill-amber-300 text-amber-300" aria-hidden />
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
    <article className="glass flex flex-col gap-3 rounded-xl p-4">
      <div className="flex items-center gap-2">
        <Link
          href={item.kind === "company" ? `/stock/${item.refId}` : `/insider/${item.refId}`}
          className="min-w-0 flex-1 truncate font-semibold tracking-tight hover:text-teal"
        >
          {item.kind === "company" ? <span className="font-mono">{item.refId}</span> : null}{" "}
          <span className="text-sm text-muted-foreground">{item.label}</span>
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
        <Skeleton className="h-24 w-full rounded-lg bg-white/4" />
      ) : trades.length === 0 ? (
        <p className="py-4 text-center text-xs text-subtle-foreground">No recent activity.</p>
      ) : (
        <>
          <p className="text-2xs text-subtle-foreground">
            Recent: {buys} buys · {sells} sells · net{" "}
            <span className={netUsd < 0 ? "text-sell" : "text-buy"}>
              {netUsd < 0 ? "−" : ""}${formatCompact(Math.abs(netUsd))}
            </span>
          </p>
          <ul className="flex flex-col gap-1.5">
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

  return (
    <div className="flex flex-col gap-6 pb-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Watchlist</h1>
        <p className="text-sm text-muted-foreground">
          Stored in this browser for now — accounts sync it across devices in Phase 7.
        </p>
      </header>

      <AddCompany />

      {items.length === 0 ? (
        <div className="glass flex flex-col items-center gap-3 rounded-xl px-6 py-14 text-center">
          <Star className="size-6 text-subtle-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Nothing watched yet. Add a company above, or hit “Watch” on any{" "}
            <Link href="/companies" className="text-teal underline underline-offset-4">
              company
            </Link>{" "}
            or insider page.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2" data-testid="watchlist-items">
          {items.map((item) => (
            <WatchCard key={item.id} item={item} onRemove={() => remove(item.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
