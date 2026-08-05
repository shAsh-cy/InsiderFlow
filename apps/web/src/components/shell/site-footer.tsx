import Link from "next/link";

/**
 * Site-wide footer. Its job is the disclaimer.
 *
 * "Not investment advice" appears on EVERY page, not just the landing page,
 * because any page can be the first one someone lands on from a search result
 * or a shared link — and a page of insider trades with no disclaimer reads as
 * a recommendation.
 */
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-white/6 px-4 py-8 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 text-xs leading-relaxed text-subtle-foreground">
        <p data-testid="footer-disclaimer">
          <strong className="text-muted-foreground">Not investment advice.</strong> InsiderFlow
          republishes public regulatory filings for research and education. Filings can be late,
          amended, incomplete, or wrong, and insider activity is not a reliable predictor of
          returns. Analytics on this site are backward-looking descriptive statistics, not
          forecasts.
        </p>
        <nav aria-label="Legal and reference" className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/legal" className="hover:text-foreground">
            Legal &amp; data sources
          </Link>
          <Link href="/docs/methodology" className="hover:text-foreground">
            Methodology
          </Link>
          <Link href="/docs" className="hover:text-foreground">
            API
          </Link>
          <Link href="/status" className="hover:text-foreground">
            Status
          </Link>
          <a
            href="https://github.com/insiderflow/insiderflow"
            className="hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            Source (AGPL-3.0)
          </a>
        </nav>
      </div>
    </footer>
  );
}
