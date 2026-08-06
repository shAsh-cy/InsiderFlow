import { notFound } from "next/navigation";
import { z } from "zod";

import { InsiderScorePanel } from "@/components/analytics/insider-score-panel";
import { StatCard } from "@/components/domain/stat-card";
import { TradeTable } from "@/components/trades/trade-table";
import { WatchlistButton } from "@/components/watchlist/watchlist-button";
import { queryInsiderScore } from "@/lib/api/analytics-queries";
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

  const [trades, score] = await Promise.all([
    queryTrades(db, {
      ...tradesQuerySchema.parse({}),
      insider_id: insider.id,
      limit: 100,
    }).catch(() => ({ data: [] })),
    queryInsiderScore(db, insider.id).catch(() => ({ summary: null, trades: [] })),
  ]);

  const roles = [
    insider.isDirector ? "Director" : null,
    insider.isOfficer ? (insider.officerTitle ?? "Officer") : null,
    insider.isTenPctOwner ? "10% owner" : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-8 pb-24">
      <header className="flex flex-wrap items-center gap-4">
        {/* A stamped tile, matching the ticker monogram on the stock page.
            Square rather than circular on purpose: this is a filer's mark on
            paper, and the round shape in this product means "clickable". */}
        <span
          aria-hidden
          className="surface-sunken flex size-12 items-center justify-center rounded-lg text-lg font-semibold text-ink-muted"
        >
          {insider.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">
            {insider.name}
          </h1>
          <p className="text-sm text-ink-muted">
            {roles.length > 0 ? roles.join(" · ") : "Insider"}
            {insider.cik ? (
              <>
                {" · CIK "}
                <span className="num">{insider.cik}</span>
              </>
            ) : null}
          </p>
        </div>
        <WatchlistButton kind="insider" refId={insider.id} label={insider.name} market="US" />
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Buys" value={stats.buys} />
        <StatCard label="Sells" value={stats.sells} />
        <StatCard label="Net USD" value={stats.netUsd} preset="signed-usd" accent />
        <StatCard label="Companies" value={stats.companiesTraded} />
      </div>

      <InsiderScorePanel detail={score} />

      <section aria-label="Trade history" className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-muted">
          Cross-company trade history
          {stats.lastActivity ? (
            <span className="ml-2 normal-case tracking-normal text-ink-faint">
              · last activity <span className="num">{stats.lastActivity}</span>
            </span>
          ) : null}
        </h2>
        {trades.data.length === 0 ? (
          <p className="surface rounded-lg px-4 py-8 text-center text-sm text-ink-muted">
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
