import { Lock } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";

import { StatCard } from "@/components/domain/stat-card";
import { TradeTable } from "@/components/trades/trade-table";
import { WatchlistButton } from "@/components/watchlist/watchlist-button";
import { queryInsiderProfile } from "@/lib/api/page-queries";
import { queryTrades } from "@/lib/api/queries";
import { tradesQuerySchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";

export const metadata = { title: "Insider profile" };

export default async function InsiderPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!parsed.success) notFound();

  const db = getDb();
  const profile = await queryInsiderProfile(db, parsed.data).catch(() => null);
  if (!profile) notFound();
  const { insider, stats } = profile;

  const trades = await queryTrades(db, {
    ...tradesQuerySchema.parse({}),
    insider_id: insider.id,
    limit: 100,
  }).catch(() => ({ data: [] }));

  const roles = [
    insider.isDirector ? "Director" : null,
    insider.isOfficer ? (insider.officerTitle ?? "Officer") : null,
    insider.isTenPctOwner ? "10% owner" : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-8 pb-24">
      <header className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden
          className="glass flex size-12 items-center justify-center rounded-full text-lg font-semibold text-muted-foreground"
        >
          {insider.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{insider.name}</h1>
          <p className="text-sm text-muted-foreground">
            {roles.length > 0 ? roles.join(" · ") : "Insider"}
            {insider.cik ? ` · CIK ${insider.cik}` : ""}
          </p>
        </div>
        <WatchlistButton kind="insider" refId={insider.id} label={insider.name} market="US" />
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Buys" value={stats.buys} />
        <StatCard label="Sells" value={stats.sells} />
        <StatCard label="Net USD" value={stats.netUsd} preset="signed-usd" accent />
        <StatCard label="Companies" value={stats.companiesTraded} />
        {/* Phase 8 computes this — deliberately not invented here. */}
        <div
          className="glass relative rounded-xl p-4 opacity-70"
          aria-label="Performance score (coming soon)"
        >
          <p className="text-2xs font-medium uppercase tracking-widest text-muted-foreground">
            Performance score
          </p>
          <p className="mt-1.5 flex items-center gap-2 text-2xl font-semibold text-subtle-foreground">
            <Lock className="size-4" aria-hidden /> —
          </p>
          <p className="text-2xs mt-1 text-subtle-foreground">Coming in Phase 8</p>
        </div>
      </div>

      <section aria-label="Trade history" className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Cross-company trade history
          {stats.lastActivity ? (
            <span className="ml-2 normal-case tracking-normal text-subtle-foreground">
              · last activity {stats.lastActivity}
            </span>
          ) : null}
        </h2>
        {trades.data.length === 0 ? (
          <p className="glass rounded-lg px-4 py-8 text-center text-sm text-muted-foreground">
            No transactions on record.
          </p>
        ) : (
          <TradeTable
            rows={trades.data}
            showCompany
            showInsider={false}
            aria-label={`Trades by ${insider.name}`}
          />
        )}
      </section>
    </div>
  );
}
