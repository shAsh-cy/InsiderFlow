import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { SIC_SECTOR_RANGES } from "@insiderflow/core";

export const metadata = {
  title: "Methodology",
  description:
    "Exactly how InsiderFlow computes clusters, sectors, performance scores, and anomaly scores. Every formula, stated in full.",
};

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-3">
      {/* The self-link is marked by a rule on hover, not by colour: this page
          has one accent and it is spent on the advisory at the top. */}
      <h2 className="text-xl font-semibold tracking-tight text-ink">
        <a
          href={`#${id}`}
          className="cursor-pointer decoration-border underline-offset-4 hover:underline"
        >
          {title}
        </a>
      </h2>
      <div className="flex flex-col gap-4 text-base leading-relaxed text-ink-muted">{children}</div>
    </section>
  );
}

/** A stated formula. Sunken, mono and tabular so the ASCII alignment that
 *  carries the meaning survives — these blocks are read column-wise. */
function Formula({ children }: { children: React.ReactNode }) {
  return (
    <pre className="surface-sunken num overflow-x-auto rounded-md p-4 text-xs leading-relaxed text-ink">
      {children}
    </pre>
  );
}

const TOC = [
  ["principles", "Principles"],
  ["clusters", "Cluster detection"],
  ["sectors", "Sector classification"],
  ["scoring", "Insider performance scoring"],
  ["anomaly", "Net-flow anomaly score"],
  ["politicians", "Congressional disclosures"],
  ["limits", "Known limitations"],
] as const;

export default function MethodologyPage() {
  // 68ch: this is a page of argument, and an argument read across a
  // 120-character line is read twice.
  return (
    <main id="main" className="shell-gutter pt-20 pb-24">
      <div data-content-region className="flex max-w-[68ch] flex-col gap-10">
        <header className="rail-bleed flex flex-col gap-3 border-b border-border pb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Methodology</h1>
          <p className="text-base leading-relaxed text-ink-muted">
            Every derived number on InsiderFlow is computed by a formula stated on this page, from
            public regulatory filings and public price data. There is no proprietary model, no
            weighting nobody can see, and nothing here is a prediction.
          </p>
        </header>

        {/* The one accent on this page. A caveat the reader must not skim past
          is exactly what a scarce colour is saved for. */}
        <div className="surface-sunken flex items-start gap-3 rounded-lg p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden />
          <p className="text-sm leading-relaxed text-ink-muted">
            <strong className="font-semibold text-ink">
              Informational only — not investment advice.
            </strong>{" "}
            These are backward-looking descriptive statistics. They describe what happened after
            past filings; they do not forecast what will happen after future ones. InsiderFlow is
            not a broker, adviser, or fiduciary.
          </p>
        </div>

        <nav aria-label="Contents" className="border-y border-border py-4">
          <p className="mb-2 text-2xs font-semibold text-ink-faint">On this page</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="cursor-pointer text-ink-muted transition-colors hover:text-ink"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <Section id="principles" title="Principles">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <strong className="font-semibold text-ink">A missing value is never a zero.</strong>{" "}
              If a filing does not disclose a price, a value, or a share count, the derived figure
              is null and the UI says so. Substituting zero would turn an absence of data into a
              claim.
            </li>
            <li>
              <strong className="font-semibold text-ink">Nothing is invented to fill a gap.</strong>{" "}
              STOCK Act filings disclose amount <em>ranges</em>; we store the range and never
              synthesise a midpoint. A horizon with no price data yields null, not an interpolation.
            </li>
            <li>
              <strong className="font-semibold text-ink">
                Small samples are shrunk, not celebrated.
              </strong>{" "}
              One profitable trade is not skill. Composite scores are pulled toward zero in
              proportion to how little evidence supports them.
            </li>
            <li>
              <strong className="font-semibold text-ink">Every aggregate is auditable.</strong>{" "}
              Per-trade returns are stored, not just the averages, so any leaderboard figure can be
              traced back to the trades that produced it.
            </li>
            <li>
              <strong className="font-semibold text-ink">Synthetic fixtures are excluded.</strong>{" "}
              Test data lives in a reserved{" "}
              <code className="rounded-sm bg-fill px-1 font-mono text-sm text-ink">ZZ*</code> ticker
              namespace and is filtered out of every leaderboard, heatmap, and ranking, so a
              fabricated trade can never appear as market data.
            </li>
          </ul>
        </Section>

        <Section id="clusters" title="Cluster detection">
          <p>
            A <strong>cluster</strong> is two or more distinct insiders trading the same direction
            in the same company inside a rolling 14-day window. Buys cluster on transaction code{" "}
            <code className="rounded-sm bg-fill px-1 font-mono text-sm text-ink">P</code>{" "}
            (open-market purchase), sells on{" "}
            <code className="rounded-sm bg-fill px-1 font-mono text-sm text-ink">S</code>.
          </p>
          <Formula>{`window      = trades in the last 14 days, code P (buy) or S (sell)
insiders   = count(distinct insider_id) within the window
cluster    = insiders >= 2

window_start = min(txn_date) among those trades   ← the anchor
window_end   = max(txn_date) among those trades`}</Formula>
          <p>
            The window is <strong>anchored to its earliest qualifying trade</strong>, not to
            &ldquo;today minus 14 days&rdquo;. That gives a live cluster a stable identity as days
            pass, which is what lets a cluster alert fire once when it grows from 2 insiders to 3,
            rather than once per scan.
          </p>
          <p>
            Flags are maintained incrementally by the ingest cron (only companies with new trades
            are recomputed) and repaired by a nightly full sweep. Drift between sweeps is bounded at
            one day and always toward <em>false negatives</em> — a stale flag stops matching rather
            than starting to. Self-hosters without the analytics cron can set{" "}
            <code className="rounded-sm bg-fill px-1 font-mono text-sm text-ink">
              INSIDERFLOW_CLUSTER_SOURCE=sql
            </code>{" "}
            to compute the same set at query time; the two paths are asserted equal by a parity test
            on labelled fixtures.
          </p>
        </Section>

        <Section id="sectors" title="Sector classification">
          <p>
            Sectors are derived from the SEC <strong>Standard Industrial Classification</strong>{" "}
            code on each filer, fetched from the free EDGAR submissions API. The industry label is
            EDGAR&rsquo;s own{" "}
            <code className="rounded-sm bg-fill px-1 font-mono text-sm text-ink">
              sicDescription
            </code>
            , used verbatim.
          </p>
          <p>
            SIC is a 1987 taxonomy with no &ldquo;Technology&rdquo; division — software sits under
            Services, semiconductors under Manufacturing. The mapping below is therefore an{" "}
            <strong>opinionated regrouping</strong> into the sectors investors expect, not a
            standards-body crosswalk. GICS, the licensed alternative, cannot ship in an AGPL
            project. Ranges are inclusive and evaluated in order, so narrow special cases win over
            the broad division they sit inside. Codes that match nothing stay <em>unclassified</em>{" "}
            rather than being swept into a bucket.
          </p>
          <details className="surface-sunken rounded-lg p-4">
            <summary className="cursor-pointer text-sm font-medium text-ink">
              Full SIC → sector table (<span className="num">{SIC_SECTOR_RANGES.length}</span>{" "}
              ranges)
            </summary>
            {/* Forty-odd rows read down a column, so they get the ledger
              treatment: hairline rules and a zebra band, no per-row chrome. */}
            <div className="-mx-2 mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-2xs text-ink-faint">
                    <th className="px-2 pb-2 font-medium">SIC range</th>
                    <th className="px-2 pb-2 font-medium">Sector</th>
                    <th className="px-2 pb-2 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {SIC_SECTOR_RANGES.map((r) => (
                    <tr
                      key={`${r.from}-${r.to}`}
                      className="border-t border-border even:bg-fill/55"
                    >
                      <td className="num px-2 py-1 text-ink-muted">
                        {r.from === r.to ? r.from : `${r.from}–${r.to}`}
                      </td>
                      <td className="px-2 py-1 text-ink">{r.sector}</td>
                      <td className="px-2 py-1 text-ink-faint">{r.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Section>

        <Section id="scoring" title="Insider performance scoring">
          <p>
            <strong className="font-semibold text-ink">Which trades are scored.</strong> A
            transaction qualifies only if all of the following hold:
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>
              code <code className="rounded-sm bg-fill px-1 font-mono text-sm text-ink">P</code> or{" "}
              <code className="rounded-sm bg-fill px-1 font-mono text-sm text-ink">S</code> — an
              open-market purchase or sale
            </li>
            <li>
              relevance{" "}
              <code className="rounded-sm bg-fill px-1 font-mono text-sm text-ink">
                opportunistic
              </code>{" "}
              — routine compensation plumbing (option vesting, tax withholding) is not a decision,
              so it is not scored
            </li>
            <li>the filing has not been superseded by an amendment</li>
            <li>
              the company has a ticker on a market the free price provider covers, and a close
              exists within 7 days of both the trade date and the horizon date, for the stock and
              the benchmark
            </li>
          </ul>
          <p>
            <strong className="font-semibold text-ink">Returns.</strong> Entry is the market{" "}
            <em>close</em> on or after the trade date — never the reported trade price, which can be
            a weighted average across a whole day and is not a price anyone else could have paid.
          </p>
          <Formula>{`entry        = first close on or after txn_date        (within 7 days)
exit(h)      = first close on or after txn_date + h    (within 7 days)
return(h)    = (exit(h) − entry) / entry

bench_entry  = SPY close on or after txn_date
bench_exit(h)= SPY close on or after txn_date + h
benchmark(h) = (bench_exit(h) − bench_entry) / bench_entry

excess(h)    = return(h) − benchmark(h)          for a BUY
excess(h)    = −(return(h) − benchmark(h))       for a SELL

h ∈ {30, 90, 180} calendar days`}</Formula>
          <p>
            Excess return is <strong>signed by direction</strong>. A buy is right when the stock
            beats the market; a sale is right when it lags. Without the sign flip, a well-timed exit
            would score as a loss, and buys and sells could not be summed into one figure.
          </p>
          <p>
            <strong className="font-semibold text-ink">The composite score.</strong> One horizon,
            one statistic, one shrinkage term:
          </p>
          <Formula>{`score = mean(excess_90d) × n / (n + 5) × 100

  n = number of scored trades
  5 = prior strength (PRIOR_TRADES)`}</Formula>
          <p>
            The{" "}
            <code className="rounded-sm bg-fill px-1 font-mono text-sm text-ink">n / (n + 5)</code>{" "}
            term is the whole point. An insider with one lucky trade is statistically
            indistinguishable from one with a single unlucky trade, so their score keeps only{" "}
            <sup>1</sup>&frasl;<sub>6</sub> of its raw value; at 45 trades it keeps 90%.
            Leaderboards additionally require a minimum number of scored trades, and ties are broken
            by sample size — between two equal scores, the one with more evidence ranks higher.
          </p>
          <p>
            <strong className="font-semibold text-ink">Realised round trips.</strong> Sales are
            matched against prior purchases FIFO, within each (insider, company) pair separately.
          </p>
          <Formula>{`realised = Σ ((sell_price − buy_price) / buy_price) × shares_matched
           ────────────────────────────────────────────────────────
                            Σ shares_matched`}</Formula>
          <p>
            A sale with no matching purchase on record is <strong>skipped, not scored</strong>. We
            only see filed transactions, not the full position history, so an unmatched sale means
            &ldquo;we never saw the purchase&rdquo; — it does not mean the cost basis was zero.
          </p>
        </Section>

        <Section id="anomaly" title="Net-flow anomaly score">
          <p>
            The anomaly score answers one question:{" "}
            <em>is this company&rsquo;s current insider activity unusual for this company?</em> Each
            company is compared only to itself. $2M of net buying is extraordinary for a micro-cap
            and rounding for a mega-cap, so there is no cross-company dollar scale on which a raw
            figure means anything.
          </p>
          <Formula>{`net(w)    = Σ value_usd of acquisitions − Σ value_usd of disposals
            over 30-day window w, opportunistic trades only

current   = net(window 0)                  the last 30 days
baseline  = [net(1), net(2), … net(12)]    the 12 preceding windows

z = (current − mean(baseline)) / stddev(baseline)     sample stddev, n−1`}</Formula>
          <p>The score is withheld — shown as &ldquo;not enough history&rdquo; — when either:</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>fewer than 6 baseline windows exist, or</li>
            <li>
              the baseline has zero dispersion. Dividing by a standard deviation of zero would
              report infinite significance for a one-dollar move.
            </li>
          </ul>
          <p>
            A window with no trades counts as a real observation of zero flow, not a gap. Dropping
            quiet windows would make every company look permanently anomalous.
          </p>
        </Section>

        <Section id="politicians" title="Congressional disclosures">
          <p>
            Members of Congress must file a periodic transaction report (PTR) within{" "}
            <strong>45 days</strong> of any transaction over <span className="num">$1,000</span>,
            under the STOCK Act. Two consequences shape how this data is presented:
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <strong className="font-semibold text-ink">Amounts are brackets.</strong> A filing
              says &ldquo;<span className="num">$1,001&ndash;$15,000</span>&rdquo;, never a figure.
              We store{" "}
              <code className="rounded-sm bg-fill px-1 font-mono text-sm text-ink">amountMin</code>{" "}
              and{" "}
              <code className="rounded-sm bg-fill px-1 font-mono text-sm text-ink">amountMax</code>{" "}
              separately, either may be null (the top bracket is open-ended), and there is
              deliberately no single{" "}
              <code className="rounded-sm bg-fill px-1 font-mono text-sm text-ink">value</code>{" "}
              field. Filters match on the disclosed upper bound, which is the only sense in which a
              bracket &ldquo;clears&rdquo; a threshold.
            </li>
            <li>
              <strong className="font-semibold text-ink">
                The disclosure is the news, not the trade.
              </strong>{" "}
              A PTR filed today may describe a trade from six weeks ago. Feeds and alerts are
              ordered and timed by disclosure date; the lag is shown on every row, and filings past
              the 45-day deadline are labelled late.
            </li>
          </ul>
          <p>
            <strong className="font-semibold text-ink">Source.</strong> The authoritative filings
            live at disclosures-clerk.house.gov and efdsearch.senate.gov, but both publish PTRs as
            scanned PDFs behind session cookies — there is no machine-readable feed, and OCR would
            produce numbers we could not stand behind. So the default source is the open
            house/senate-stock-watcher datasets: volunteer transcriptions of those same public
            filings, published as plain JSON, with a link to the original PDF on every row. We store
            that link so any figure can be checked against the filing it came from. Commercial APIs
            were rejected because their terms forbid redistribution, which is incompatible with an
            AGPL project.
          </p>
        </Section>

        <Section id="limits" title="Known limitations">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <strong className="font-semibold text-ink">Survivorship and coverage.</strong> Scoring
              needs cached price history, and the free provider does not cover every ticker or
              market. Trades we cannot price are absent from the leaderboard entirely — not scored
              as zero, but also not visible as a gap.
            </li>
            <li>
              <strong className="font-semibold text-ink">One benchmark.</strong> Excess return is
              measured against SPY for every trade. That under-penalises a high-beta stock in a
              rising market and over-penalises a defensive one. There is no sector or beta
              adjustment.
            </li>
            <li>
              <strong className="font-semibold text-ink">Small samples dominate.</strong> Most
              insiders file a handful of discretionary trades. Shrinkage and minimum-trade filters
              reduce the damage; they do not eliminate it.
            </li>
            <li>
              <strong className="font-semibold text-ink">Filed prices, not executed ones.</strong>{" "}
              Reported prices are often weighted averages over a day or a range. Entry uses the
              market close precisely to avoid depending on them, but round-trip realised returns
              necessarily do.
            </li>
            <li>
              <strong className="font-semibold text-ink">Amendments.</strong> Superseded filings are
              excluded everywhere by default, so a corrected trade is scored once, on its corrected
              figures. A filing amended <em>after</em> a nightly run is rescored on the next one.
            </li>
          </ul>
        </Section>

        <p className="border-t border-border pt-6 text-2xs leading-relaxed text-ink-faint">
          Source data: SEC EDGAR (public domain), STOCK Act disclosures (public), Stooq daily
          closes. See the{" "}
          <Link
            href="/docs"
            className="cursor-pointer underline decoration-border underline-offset-2 transition-colors hover:text-ink hover:decoration-ink"
          >
            API documentation
          </Link>{" "}
          for the endpoints that serve these figures.{" "}
          <strong className="font-semibold text-ink-muted">Not investment advice.</strong>
        </p>
      </div>
    </main>
  );
}
