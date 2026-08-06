import { CheckCircle2, CircleAlert, CircleHelp } from "lucide-react";
import Link from "next/link";

import { buildHealthReport, describeAge } from "@/lib/api/health";
import type { HealthLevel, HealthReport } from "@/lib/api/health";
import { getDb } from "@/lib/db";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Status",
  description: "Live ingestion lag, per-source freshness, and alert-pipeline health.",
};

// Always fresh: a cached status page is worse than none.
export const dynamic = "force-dynamic";

const LEVEL_ICON: Record<HealthLevel, typeof CheckCircle2> = {
  ok: CheckCircle2,
  degraded: CircleAlert,
  unknown: CircleHelp,
};

/**
 * State is carried by ink weight and by the check's own written detail —
 * the glyph differs per level too, so nothing here depends on colour. Only
 * `degraded` spends the accent, which is the whole reason to open this page.
 */
const LEVEL_STYLE: Record<HealthLevel, string> = {
  ok: "text-ink-muted",
  degraded: "text-accent-ink",
  unknown: "text-ink-faint",
};

const SOURCE_LABEL: Record<string, string> = {
  edgar: "SEC EDGAR (primary)",
  finnhub: "Finnhub",
  fmp: "Financial Modeling Prep",
  "nse-bse": "NSE / BSE (India, self-hosted only)",
  "eu-mar": "EU MAR",
  sedi: "SEDI (Canada)",
};

/** Section caption. Small caps on a hairline — the panel's row of labels. */
function PanelHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-2xs font-semibold uppercase tracking-widest text-ink-muted">
      {children}
    </h2>
  );
}

export default async function StatusPage() {
  let report: HealthReport | null = null;
  let error: string | null = null;
  try {
    report = await buildHealthReport(getDb());
  } catch (e) {
    error = e instanceof Error ? e.message : "database unreachable";
  }

  if (!report) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pb-24 pt-20">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Status</h1>
        <div className="surface flex items-start gap-3 rounded-lg p-4">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold text-ink">Database unreachable.</p>
            <p className="mt-1 text-ink-muted">
              The site cannot read its database, so no data is being served.
            </p>
            {/* The raw driver message, verbatim. An operator needs the string
                it actually failed with, not a friendlier paraphrase. */}
            <p className="num mt-2 text-2xs text-ink-faint">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const healthy = report.status === "ok";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-4 pb-24 pt-20">
      <header className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Status</h1>
        <div
          data-testid="status-summary"
          className="surface flex items-center gap-3 rounded-lg p-4"
        >
          {healthy ? (
            <CheckCircle2 className="size-5 shrink-0 text-ink-muted" aria-hidden />
          ) : (
            <CircleAlert className="size-5 shrink-0 text-accent-ink" aria-hidden />
          )}
          <div>
            {/* Weight, not colour, carries the verdict — the sentence itself
                already says which of the two states this is. */}
            <p className={cn("text-sm text-ink", healthy ? "font-medium" : "font-semibold")}>
              {healthy ? "All systems operational" : "Running with degraded background jobs"}
            </p>
            <p className="mt-0.5 text-2xs text-ink-faint">
              The site and API stay available even when ingestion is behind — checked{" "}
              <span className="num">{new Date(report.checkedAt).toUTCString()}</span>
            </p>
          </div>
        </div>
      </header>

      <section aria-labelledby="checks-heading" className="flex flex-col gap-3">
        <PanelHeading id="checks-heading">Pipeline</PanelHeading>
        {/* A ruled list, not a stack of cards: these rows are read down the
            left edge, and a shadow per row would break that column. */}
        <ul className="surface flex flex-col rounded-lg" data-testid="status-checks">
          {report.checks.map((check) => {
            const Icon = LEVEL_ICON[check.level];
            return (
              <li
                key={check.name}
                className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-0"
              >
                <Icon
                  className={cn("mt-0.5 size-4 shrink-0", LEVEL_STYLE[check.level])}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "font-mono text-xs",
                      check.level === "degraded" ? "font-semibold text-ink" : "text-ink",
                    )}
                  >
                    {check.name}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">{check.detail}</p>
                </div>
                <span className="num shrink-0 text-2xs text-ink-faint">
                  {describeAge(check.ageSeconds)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="sources-heading" className="flex flex-col gap-3">
        <PanelHeading id="sources-heading">Sources</PanelHeading>
        <p className="max-w-[68ch] text-2xs leading-relaxed text-ink-faint">
          Measured from rows each source actually produced, not from a heartbeat — a job can run
          successfully and still deliver nothing.
        </p>
        {report.sources.length === 0 ? (
          <p className="surface rounded-lg px-4 py-8 text-center text-sm text-ink-muted">
            No transactions ingested yet.
          </p>
        ) : (
          <ul className="surface flex flex-col rounded-lg">
            {report.sources.map((source) => (
              <li
                key={source.source}
                className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {SOURCE_LABEL[source.source] ?? source.source}
                </span>
                <span className="num text-2xs text-ink-faint">
                  {source.rows.toLocaleString("en-US")} rows
                </span>
                <span className="num w-20 text-right text-xs text-ink-muted">
                  {describeAge(source.ageSeconds)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="counts-heading" className="flex flex-col gap-3">
        <PanelHeading id="counts-heading">Data</PanelHeading>
        <dl className="surface grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg p-4 sm:grid-cols-3">
          {(
            [
              ["Transactions", report.counts.transactions],
              ["Companies", report.counts.companies],
              ["Filings", report.counts.filings],
              ["Congressional", report.counts.politicianTrades],
              // Filings discovered but not yet fetched. Shown as a number
              // beside the rest because "how far behind is ingestion" is the
              // one operational question this page exists to answer, and it
              // was the one it could not.
              ["Filings queued", report.ingestBacklog],
              ["Alerts pending", report.counts.alertsPending],
              ["Alerts undeliverable", report.counts.alertsFailedPermanent],
              ["Alerts orphaned", report.counts.alertsOrphaned],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-2xs uppercase tracking-widest text-ink-faint">{label}</dt>
              {/* null means the metric could not be read. Printing 0 would
                  turn a broken monitor into a reassuring dashboard. */}
              <dd className="num mt-0.5 text-lg font-semibold text-ink">
                {value === null ? (
                  <span className="font-sans text-sm font-normal text-ink-faint">unknown</span>
                ) : (
                  value.toLocaleString("en-US")
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="max-w-[68ch] border-t border-border pt-6 text-2xs leading-relaxed text-ink-faint">
        Machine-readable at{" "}
        <Link
          href="/api/health"
          className="cursor-pointer font-mono underline decoration-border underline-offset-2 transition-colors hover:text-ink hover:decoration-ink"
        >
          /api/health
        </Link>
        . This page reports the health of a data pipeline; it is not a market data feed and nothing
        on it is investment advice.
      </p>
    </div>
  );
}
