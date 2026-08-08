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

/** Section eyebrows, set the same way as on the index. */
const EYEBROW = "text-xs font-semibold text-ink-muted";

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
      <header className="rail-bleed flex flex-wrap items-center gap-4">
        <span
          aria-hidden
          className="surface-sunken flex size-12 items-center justify-center rounded-full text-lg font-semibold text-ink-muted"
        >
          {politician.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">
            {politician.name}
          </h1>
          <p className="text-sm text-ink-muted">{identity}</p>
        </div>
        <Link
          href="/politicians"
          className="cursor-pointer text-xs text-ink-muted underline underline-offset-2 transition-colors hover:text-ink"
        >
          All filers
        </Link>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* The headline count takes the page's one accent — it is the figure
            everything else on this profile is a breakdown of. */}
        <StatCard label="Disclosures" value={politician.trades} accent />
        <StatCard label="Purchases" value={politician.buys} />
        <StatCard label="Sales" value={politician.sells} />
        {/* Counted, not judged: lateness is a fact on the filing, not a verdict.
            Which is also why it is set exactly like the other three. */}
        <StatCard label="Filed late (>45d)" value={politician.lateFilings} />
      </div>

      {topTickers.length > 0 ? (
        <section aria-labelledby="tickers-heading" className="flex flex-col gap-3">
          <h2 id="tickers-heading" className={EYEBROW}>
            Most-traded tickers
          </h2>
          <ul className="flex flex-wrap gap-2">
            {topTickers.map((t) => (
              <li key={t.ticker}>
                {/* Pill-shaped, because it is a link. The rectangular badges
                    in this product are the things you cannot click. */}
                <Link
                  href={`/stock/${t.ticker}`}
                  className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm transition-colors hover:bg-fill"
                >
                  <span className="num font-semibold text-ink">{t.ticker}</span>
                  <span className="text-2xs text-ink-faint">
                    <span className="num">{t.trades}</span> disclosure{t.trades === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="history-heading" className="flex flex-col gap-3">
        <h2 id="history-heading" className={EYEBROW}>
          Disclosure history
          {politician.lastDisclosure ? (
            <span className="ml-2 normal-case tracking-normal text-ink-faint">
              · last filed <span className="num">{politician.lastDisclosure}</span>
            </span>
          ) : null}
        </h2>
        <PoliticianTradeTable
          rows={trades}
          showPolitician={false}
          caption={`Disclosures filed by ${politician.name}`}
        />
      </section>

      <p className="text-2xs text-ink-faint">
        Amounts are the disclosed STOCK Act brackets, never exact figures.{" "}
        <strong>Not investment advice.</strong>
      </p>
    </div>
  );
}
