import { AlertTriangle, Database, Info } from "lucide-react";
import Link from "next/link";

import type { PoliticianCoverage } from "@/lib/api/analytics-queries";

/** Past this, the feed is describing history rather than current activity. */
const STALE_AFTER_DAYS = 21;

/**
 * States what congressional data is actually present, and how current it is.
 *
 * This exists because the upstream PTR datasets are community-maintained and
 * have gone dark before — as of 2026-08-04 the house/senate-stock-watcher S3
 * buckets return HTTP 403. An empty feed and a dead pipeline look identical to
 * a reader, so the page says which one it is instead of leaving them to guess.
 */
export function PoliticianCoverageBanner({ coverage }: { coverage: PoliticianCoverage }) {
  if (coverage.disclosures === 0) {
    /*
     * The empty state is the page, so it is set as an editorial note rather
     * than an alert: a kicker, a stated headline, a standfirst, then three
     * short columns that answer what the source is, why it is silent, and
     * what a reader can do about it.
     *
     * Deliberately not a warning box. Nothing here is broken from the
     * reader's side and nothing needs their urgent attention — an amber
     * triangle would be claiming otherwise, and would also be the fourth
     * different way this product renders "caution". The only colour spent is
     * a 2px oxblood margin rule, the same mark the sidebar uses for "you are
     * here": this is the one thing on the page worth reading.
     */
    return (
      <div
        role="status"
        data-testid="politician-coverage"
        className="surface rounded-lg rail p-6 sm:p-8"
      >
        <p className="text-2xs font-semibold text-ink-faint">Source status</p>
        <p className="mt-2 text-xl font-semibold tracking-tight text-ink">
          No congressional disclosures ingested.
        </p>
        <p className="mt-3 max-w-prose text-sm text-ink-muted">
          The feed below is empty because the pipeline is empty — not because filing stopped.
          Nothing has been filtered, sampled, or rounded away to get here.
        </p>

        <dl className="mt-6 grid gap-x-10 gap-y-6 border-t border-border pt-6 sm:grid-cols-3">
          <div>
            <dt className="text-2xs font-semibold text-ink-faint">The source</dt>
            <dd className="mt-1.5 text-sm text-ink-muted">
              The default upstream source is the community house/senate-stock-watcher datasets,
              which transcribe House and Senate periodic transaction reports into a machine-readable
              feed.
            </dd>
          </div>
          <div>
            <dt className="text-2xs font-semibold text-ink-faint">Why nothing is shown</dt>
            <dd className="mt-1.5 text-sm text-ink-muted">
              This deployment has not loaded any STOCK Act filings. That source is currently
              unavailable, and the official House and Senate portals publish periodic transaction
              reports only as scanned PDFs — there is no free machine-readable feed to fall back to.
            </dd>
          </div>
          <div>
            <dt className="text-2xs font-semibold text-ink-faint">What you can do</dt>
            <dd className="mt-1.5 text-sm text-ink-muted">
              An operator can point the ingestion job at any source they have the rights to use via{" "}
              <code className="rounded-sm border border-border bg-fill px-1 font-mono text-2xs text-ink">
                HOUSE_PTR_URL
              </code>{" "}
              /{" "}
              <code className="rounded-sm border border-border bg-fill px-1 font-mono text-2xs text-ink">
                SENATE_PTR_URL
              </code>
              . The procedure is in{" "}
              <Link
                href="https://github.com/insiderflow/insiderflow/blob/main/docs/politicians.md"
                className="cursor-pointer text-ink underline underline-offset-2 transition-colors hover:text-accent-ink"
              >
                docs/politicians.md
              </Link>
              .
            </dd>
          </div>
        </dl>

        <p className="mt-6 border-t border-border pt-4 text-2xs text-ink-faint">
          Showing nothing is deliberate. Inventing or estimating disclosures would be worse than an
          empty page.
        </p>
      </div>
    );
  }

  const stale = coverage.ageDays !== null && coverage.ageDays > STALE_AFTER_DAYS;
  const Icon = stale ? AlertTriangle : Database;

  /*
   * The healthy case is a masthead line, not a card: one hairline strip that
   * states the vintage of the data and gets out of the way. Staleness is the
   * only condition here that earns the accent — a feed three weeks behind is
   * something a reader must not skim past.
   */
  return (
    <div
      role="status"
      data-testid="politician-coverage"
      className={`surface-sunken flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-4 py-3 text-sm ${
        stale ? "rail" : ""
      }`}
    >
      <Icon
        className={`size-4 shrink-0 ${stale ? "text-accent-ink" : "text-ink-faint"}`}
        aria-hidden
      />
      <p className="text-ink-muted">
        <span className="font-semibold text-ink">
          Data through <span className="num">{coverage.latestDisclosure}</span>
        </span>{" "}
        · <span className="num">{coverage.disclosures.toLocaleString("en-US")}</span> disclosures
        from <span className="num">{coverage.filers}</span> filers
        {coverage.earliestDisclosure ? (
          <>
            {" · since "}
            <span className="num">{coverage.earliestDisclosure}</span>
          </>
        ) : null}
      </p>
      {stale ? (
        <p className="text-accent-ink">
          Last filing is <span className="num">{coverage.ageDays}</span> days old — the upstream
          source may have stopped updating.
        </p>
      ) : null}
      {coverage.sources.length > 0 ? (
        <p className="text-2xs ml-auto text-ink-faint">Source: {coverage.sources.join(", ")}</p>
      ) : null}
    </div>
  );
}

/** Compact variant for the stock-page overlay. */
export function PoliticianCoverageNote({ coverage }: { coverage: PoliticianCoverage }) {
  if (coverage.disclosures === 0) return null;
  return (
    <p className="text-2xs flex items-center gap-1.5 text-ink-faint">
      <Info className="size-3" aria-hidden />
      Congressional data through <span className="num">{coverage.latestDisclosure}</span>.
    </p>
  );
}
