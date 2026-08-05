import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { StatCard } from "@/components/domain/stat-card";
import { PoliticianTradeTable } from "@/components/politicians/politician-trade-table";
import {
  queryPolitician,
  queryPoliticianTrades,
  queryTopPoliticianTickers,
} from "@/lib/api/analytics-queries";
import { politiciansQuerySchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";

export const metadata = { title: "Politician profile" };
export const revalidate = 3600;

export default async function PoliticianPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!parsed.success) notFound();

  const db = getDb();
  const politician = await queryPolitician(db, parsed.data).catch(() => null);
  if (!politician) notFound();

  const [{ data: trades }, topTickers] = await Promise.all([
    queryPoliticianTrades(db, {
      ...politiciansQuerySchema.parse({}),
      politician_id: politician.id,
      limit: 100,
    }).catch(() => ({ data: [] })),
    queryTopPoliticianTickers(db, { politicianId: politician.id, limit: 10 }).catch(() => []),
  ]);

  const identity = [
    politician.chamber === "house" ? "House" : "Senate",
    politician.party,
    politician.state,
    politician.district,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-8 pb-24">
      <header className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden
          className="glass flex size-12 items-center justify-center rounded-full text-lg font-semibold text-muted-foreground"
        >
          {politician.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{politician.name}</h1>
          <p className="text-sm text-muted-foreground">{identity}</p>
        </div>
        <Link
          href="/politicians"
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          All filers
        </Link>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Disclosures" value={politician.trades} />
        <StatCard label="Purchases" value={politician.buys} />
        <StatCard label="Sales" value={politician.sells} />
        {/* Counted, not judged: lateness is a fact on the filing, not a verdict. */}
        <StatCard label="Filed late (>45d)" value={politician.lateFilings} />
      </div>

      {topTickers.length > 0 ? (
        <section aria-labelledby="tickers-heading" className="flex flex-col gap-3">
          <h2
            id="tickers-heading"
            className="text-sm font-semibold uppercase tracking-widest text-muted-foreground"
          >
            Most-traded tickers
          </h2>
          <ul className="flex flex-wrap gap-2">
            {topTickers.map((t) => (
              <li key={t.ticker}>
                <Link
                  href={`/stock/${t.ticker}`}
                  className="glass flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-white/6"
                >
                  <span className="font-medium">{t.ticker}</span>
                  <span className="tnum text-2xs text-subtle-foreground">
                    {t.trades} disclosure{t.trades === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="history-heading" className="flex flex-col gap-3">
        <h2
          id="history-heading"
          className="text-sm font-semibold uppercase tracking-widest text-muted-foreground"
        >
          Disclosure history
          {politician.lastDisclosure ? (
            <span className="ml-2 normal-case tracking-normal text-subtle-foreground">
              · last filed {politician.lastDisclosure}
            </span>
          ) : null}
        </h2>
        <PoliticianTradeTable
          rows={trades}
          showPolitician={false}
          caption={`Disclosures filed by ${politician.name}`}
        />
      </section>

      <p className="text-2xs text-subtle-foreground">
        Amounts are the disclosed STOCK Act brackets, never exact figures.{" "}
        <strong>Not investment advice.</strong>
      </p>
    </div>
  );
}
