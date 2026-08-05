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

const LEVEL_STYLE: Record<HealthLevel, string> = {
  ok: "text-emerald-300",
  degraded: "text-amber-300",
  unknown: "text-subtle-foreground",
};

const SOURCE_LABEL: Record<string, string> = {
  edgar: "SEC EDGAR (primary)",
  finnhub: "Finnhub",
  fmp: "Financial Modeling Prep",
  "nse-bse": "NSE / BSE (India, self-hosted only)",
  "eu-mar": "EU MAR",
  sedi: "SEDI (Canada)",
};

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
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Status</h1>
        <div className="glass flex items-start gap-3 rounded-xl border border-red-400/30 p-4">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-300" aria-hidden />
          <div className="text-sm">
            <p className="font-medium text-foreground">Database unreachable.</p>
            <p className="mt-1 text-muted-foreground">
              The site cannot read its database, so no data is being served.
            </p>
            <p className="mt-2 font-mono text-2xs text-subtle-foreground">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const healthy = report.status === "ok";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12 pb-24">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Status</h1>
        <div
          data-testid="status-summary"
          className={cn(
            "glass flex items-center gap-3 rounded-xl border p-4",
            healthy ? "border-emerald-400/25" : "border-amber-300/25",
          )}
        >
          {healthy ? (
            <CheckCircle2 className="size-5 shrink-0 text-emerald-300" aria-hidden />
          ) : (
            <CircleAlert className="size-5 shrink-0 text-amber-300" aria-hidden />
          )}
          <div>
            <p className="font-medium">
              {healthy ? "All systems operational" : "Running with degraded background jobs"}
            </p>
            <p className="text-2xs text-subtle-foreground">
              The site and API stay available even when ingestion is behind — checked{" "}
              {new Date(report.checkedAt).toUTCString()}
            </p>
          </div>
        </div>
      </header>

      <section aria-labelledby="checks-heading" className="flex flex-col gap-3">
        <h2
          id="checks-heading"
          className="text-sm font-semibold uppercase tracking-widest text-muted-foreground"
        >
          Pipeline
        </h2>
        <ul className="glass flex flex-col rounded-xl" data-testid="status-checks">
          {report.checks.map((check) => {
            const Icon = LEVEL_ICON[check.level];
            return (
              <li
                key={check.name}
                className="flex items-start gap-3 border-b border-white/5 px-4 py-3 last:border-0"
              >
                <Icon
                  className={cn("mt-0.5 size-4 shrink-0", LEVEL_STYLE[check.level])}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-foreground">{check.name}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{check.detail}</p>
                </div>
                <span className="tnum text-2xs shrink-0 text-subtle-foreground">
                  {describeAge(check.ageSeconds)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="sources-heading" className="flex flex-col gap-3">
        <h2
          id="sources-heading"
          className="text-sm font-semibold uppercase tracking-widest text-muted-foreground"
        >
          Sources
        </h2>
        <p className="text-2xs text-subtle-foreground">
          Measured from rows each source actually produced, not from a heartbeat — a job can run
          successfully and still deliver nothing.
        </p>
        {report.sources.length === 0 ? (
          <p className="glass rounded-xl px-4 py-8 text-center text-sm text-muted-foreground">
            No transactions ingested yet.
          </p>
        ) : (
          <ul className="glass flex flex-col rounded-xl">
            {report.sources.map((source) => (
              <li
                key={source.source}
                className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {SOURCE_LABEL[source.source] ?? source.source}
                </span>
                <span className="tnum text-2xs text-subtle-foreground">
                  {source.rows.toLocaleString("en-US")} rows
                </span>
                <span className="tnum w-20 text-right text-xs text-muted-foreground">
                  {describeAge(source.ageSeconds)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="counts-heading" className="flex flex-col gap-3">
        <h2
          id="counts-heading"
          className="text-sm font-semibold uppercase tracking-widest text-muted-foreground"
        >
          Data
        </h2>
        <dl className="glass grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl p-4 text-sm sm:grid-cols-3">
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
              <dt className="text-2xs uppercase tracking-widest text-subtle-foreground">{label}</dt>
              {/* null means the metric could not be read. Printing 0 would
                  turn a broken monitor into a reassuring dashboard. */}
              <dd className="tnum text-lg font-semibold">
                {value === null ? (
                  <span className="text-subtle-foreground">unknown</span>
                ) : (
                  value.toLocaleString("en-US")
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="text-2xs text-subtle-foreground">
        Machine-readable at{" "}
        <Link href="/api/health" className="underline underline-offset-2">
          /api/health
        </Link>
        . This page reports the health of a data pipeline; it is not a market data feed and nothing
        on it is investment advice.
      </p>
    </div>
  );
}
