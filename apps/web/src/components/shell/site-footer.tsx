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
    <footer className="mt-16 border-t border-border px-4 py-8 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 text-xs leading-relaxed text-ink-faint">
        <p data-testid="footer-disclaimer" className="max-w-[68ch]">
          <strong className="font-semibold text-ink-muted">Not investment advice.</strong>{" "}
          InsiderFlow republishes public regulatory filings for research and education. Filings can
          be late, amended, incomplete, or wrong, and insider activity is not a reliable predictor
          of returns. Analytics on this site are backward-looking descriptive statistics, not
          forecasts.
        </p>
        <nav
          aria-label="Legal and reference"
          className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3"
        >
          <Link href="/legal" className="transition-colors hover:text-ink">
            Legal &amp; data sources
          </Link>
          <Link href="/docs/methodology" className="transition-colors hover:text-ink">
            Methodology
          </Link>
          <Link href="/docs" className="transition-colors hover:text-ink">
            API
          </Link>
          <Link href="/status" className="transition-colors hover:text-ink">
            Status
          </Link>
          <a
            href="https://github.com/insiderflow/insiderflow"
            className="transition-colors hover:text-ink"
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
