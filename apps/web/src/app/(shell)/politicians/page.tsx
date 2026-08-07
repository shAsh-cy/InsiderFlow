import { Rss } from "lucide-react";
import Link from "next/link";

import { NotDisclosed } from "@/components/domain/not-disclosed";
import { PoliticianCoverageBanner } from "@/components/politicians/coverage-banner";
import { PoliticianTradeTable } from "@/components/politicians/politician-trade-table";
import {
  queryPoliticianCoverage,
  queryPoliticians,
  queryPoliticianTrades,
  queryTopPoliticianTickers,
} from "@/lib/api/analytics-queries";
import { politiciansQuerySchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Congressional trading",
  description:
    "STOCK Act periodic transaction reports from the House and Senate. Amounts are disclosed brackets, never exact figures.",
};

export const revalidate = 3600;

const CHAMBERS = [
  { key: "", label: "All" },
  { key: "house", label: "House" },
  { key: "senate", label: "Senate" },
] as const;

/**
 * Chamber and lateness are URL state, so they stay links — the back button has
 * to walk through them. Pill-shaped because they are interactive; the selected
 * one is marked by weight and ground rather than by colour, so the page's one
 * accent is still available for something that matters more.
 */
const PILL_BASE = "cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors";
const PILL_ON = "border-border bg-fill font-semibold text-ink";
const PILL_OFF = "border-transparent text-ink-muted hover:bg-fill hover:text-ink";

/** Section eyebrows, set the same way across the page. */
const EYEBROW = "text-xs font-semibold text-ink-muted";

export default async function PoliticiansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(raw)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, Array.isArray(v) ? v[0]! : v]),
  );
  const query = politiciansQuerySchema.parse(flat);

  const db = getDb();
  const [{ data: trades }, filers, topTickers, coverage] = await Promise.all([
    queryPoliticianTrades(db, query).catch(() => ({ data: [] })),
    queryPoliticians(db, 12).catch(() => []),
    queryTopPoliticianTickers(db, { days: 90, limit: 12 }).catch(() => []),
    queryPoliticianCoverage(db).catch(() => ({
      disclosures: 0,
      filers: 0,
      latestDisclosure: null,
      earliestDisclosure: null,
      sources: [],
      ageDays: null,
    })),
  ]);

  /*
   * "Nothing has ever been ingested" is a different state from "your filter
   * matched nothing", and it gets a different page. Stacking three empty
   * panels under a note that already said the feed is empty says it four
   * times; the editorial panel says it once, properly. A filter that happens
   * to match no rows still renders the full furniture, because there the
   * empty table IS the answer to the reader's question.
   *
   * Every source has to agree before the page collapses. The coverage count
   * degrades to zero when its query fails, and a failed count must not be
   * allowed to hide rows we demonstrably have.
   */
  const nothingIngested = coverage.disclosures === 0 && trades.length === 0 && filers.length === 0;

  const href = (patch: Record<string, string>) => {
    const params = new URLSearchParams();
    if (query.chamber) params.set("chamber", query.chamber);
    if (query.late_only) params.set("late_only", "true");
    if (query.ticker) params.set("ticker", query.ticker);
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    const qs = params.toString();
    return qs ? `/politicians?${qs}` : "/politicians";
  };

  const rssHref = `/api/rss/politicians${query.chamber ? `?chamber=${query.chamber}` : ""}`;

  return (
    <div className="flex flex-col gap-8 pb-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Congressional trading</h1>
        <p className="max-w-3xl text-sm text-ink-muted">
          Periodic transaction reports filed under the STOCK Act. Members must disclose any
          transaction over $1,000 within 45 days — so a trade can surface here weeks after it
          happened, and the disclosure date is the news.
        </p>
      </header>

      {/* Coverage first: an empty feed and a dead upstream look identical
          otherwise, and the reader deserves to know which they are seeing. */}
      <PoliticianCoverageBanner coverage={coverage} />

      {/* Said once, prominently: these are ranges, not figures. */}
      <p className="surface-sunken rounded-lg p-4 text-sm text-ink-muted">
        <strong className="font-semibold text-ink">Amounts are ranges.</strong> Filers disclose a
        bracket (&ldquo;$1,001&ndash;$15,000&rdquo;), never an exact figure. Every amount below is
        the bracket as filed; InsiderFlow does not synthesise a midpoint or a point value, because
        the filing does not contain one. Each row links to the original PTR.
      </p>

      {nothingIngested ? null : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <fieldset className="flex items-center gap-1.5">
              <legend className="sr-only">Chamber</legend>
              <span className="text-2xs text-ink-faint">Chamber</span>
              {CHAMBERS.map((c) => (
                <Link
                  key={c.key || "all"}
                  href={href({ chamber: c.key })}
                  aria-current={(query.chamber ?? "") === c.key ? "true" : undefined}
                  className={cn(PILL_BASE, (query.chamber ?? "") === c.key ? PILL_ON : PILL_OFF)}
                >
                  {c.label}
                </Link>
              ))}
            </fieldset>

            <Link
              href={href({ late_only: query.late_only ? "" : "true" })}
              aria-pressed={query.late_only ? "true" : "false"}
              className={cn(PILL_BASE, query.late_only ? PILL_ON : PILL_OFF)}
            >
              Late filings only
            </Link>

            <a
              href={rssHref}
              target="_blank"
              rel="noreferrer"
              className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-ink-muted transition-colors hover:text-ink"
            >
              <Rss className="size-3.5" aria-hidden /> RSS
            </a>
          </div>

          <section aria-labelledby="feed-heading" className="flex flex-col gap-3">
            <h2 id="feed-heading" className={EYEBROW}>
              Latest disclosures
            </h2>
            <PoliticianTradeTable rows={trades} caption="Recent congressional disclosures" />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="filers-heading" className="flex flex-col gap-3">
              <h2 id="filers-heading" className={EYEBROW}>
                Most active filers
              </h2>
              {filers.length === 0 ? (
                <p className="surface-sunken rounded-lg px-4 py-8 text-center text-sm text-ink-muted">
                  No filers ingested yet.
                </p>
              ) : (
                <ul className="surface flex flex-col rounded-lg">
                  {filers.map((f) => (
                    <li key={f.id} className="border-b border-border last:border-0">
                      <Link
                        href={`/politicians/${f.id}`}
                        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-fill"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-ink">
                          {f.name}
                        </span>
                        <span className="text-2xs text-ink-faint">
                          {f.chamber}
                          {f.party ? `-${f.party}` : ""}
                        </span>
                        <span className="num w-16 text-right text-ink-muted">
                          {f.trades.toLocaleString("en-US")}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="tickers-heading" className="flex flex-col gap-3">
              <h2 id="tickers-heading" className={EYEBROW}>
                Top-traded tickers <span className="normal-case tracking-normal">(90 days)</span>
              </h2>
              {topTickers.length === 0 ? (
                <p className="surface-sunken rounded-lg px-4 py-8 text-center text-sm text-ink-muted">
                  No ticker activity in this window.
                </p>
              ) : (
                <ul className="surface flex flex-col rounded-lg">
                  {topTickers.map((t) => (
                    <li key={t.ticker} className="border-b border-border last:border-0">
                      <Link
                        href={`/stock/${t.ticker}`}
                        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-fill"
                      >
                        <span className="num w-16 font-semibold text-ink">{t.ticker}</span>
                        <span className="min-w-0 flex-1 truncate text-ink-muted">
                          {t.companyName ?? (
                            <NotDisclosed
                              label="No company name on file for this ticker"
                              className="cursor-pointer"
                            />
                          )}
                        </span>
                        {/* Word plus colour, never colour alone. */}
                        <span className="num text-2xs text-buy-ink">{t.buys} buy</span>
                        <span className="num text-2xs text-sell-ink">{t.sells} sell</span>
                        <span className="num w-8 text-right text-ink-faint">{t.politicians}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      <p className="text-2xs text-ink-faint">
        Source: public STOCK Act disclosures, transcribed by the open house/senate-stock-watcher
        datasets, with a link to the original PDF on every row. See{" "}
        <Link
          href="/docs/methodology"
          className="cursor-pointer underline underline-offset-2 transition-colors hover:text-ink"
        >
          methodology
        </Link>
        . <strong>Not investment advice.</strong>
      </p>
    </div>
  );
}
