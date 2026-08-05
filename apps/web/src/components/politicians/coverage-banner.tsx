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
    return (
      <div
        role="status"
        data-testid="politician-coverage"
        className="glass flex items-start gap-3 rounded-xl border border-amber-300/25 p-4"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No congressional disclosures ingested.</p>
          <p className="mt-1">
            This deployment has not loaded any STOCK Act filings. The default upstream source (the
            community house/senate-stock-watcher datasets) is currently unavailable, and the
            official House and Senate portals publish periodic transaction reports only as scanned
            PDFs — there is no free machine-readable feed to fall back to.
          </p>
          <p className="mt-2">
            An operator can point the ingestion job at any source they have the rights to use via{" "}
            <code>HOUSE_PTR_URL</code> / <code>SENATE_PTR_URL</code>. The procedure is in{" "}
            <Link
              href="https://github.com/insiderflow/insiderflow/blob/main/docs/politicians.md"
              className="underline underline-offset-2"
            >
              docs/politicians.md
            </Link>
            .
          </p>
          <p className="mt-2 text-2xs">
            Showing nothing is deliberate. Inventing or estimating disclosures would be worse than
            an empty page.
          </p>
        </div>
      </div>
    );
  }

  const stale = coverage.ageDays !== null && coverage.ageDays > STALE_AFTER_DAYS;
  const Icon = stale ? AlertTriangle : Database;

  return (
    <div
      role="status"
      data-testid="politician-coverage"
      className={`glass flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border p-4 text-sm ${
        stale ? "border-amber-300/25" : "border-white/8"
      }`}
    >
      <Icon
        className={`size-4 shrink-0 ${stale ? "text-amber-300" : "text-muted-foreground"}`}
        aria-hidden
      />
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">
          Data through {coverage.latestDisclosure}
        </span>{" "}
        · {coverage.disclosures.toLocaleString("en-US")} disclosures from {coverage.filers} filers
        {coverage.earliestDisclosure ? ` · since ${coverage.earliestDisclosure}` : ""}
      </p>
      {stale ? (
        <p className="text-amber-200/90">
          Last filing is {coverage.ageDays} days old — the upstream source may have stopped
          updating.
        </p>
      ) : null}
      {coverage.sources.length > 0 ? (
        <p className="text-2xs ml-auto text-subtle-foreground">
          Source: {coverage.sources.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

/** Compact variant for the stock-page overlay. */
export function PoliticianCoverageNote({ coverage }: { coverage: PoliticianCoverage }) {
  if (coverage.disclosures === 0) return null;
  return (
    <p className="text-2xs flex items-center gap-1.5 text-subtle-foreground">
      <Info className="size-3" aria-hidden />
      Congressional data through {coverage.latestDisclosure}.
    </p>
  );
}
