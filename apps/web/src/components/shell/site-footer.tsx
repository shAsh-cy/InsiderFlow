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
    // The rule is full-bleed; the words are not. The disclaimer is the last
    // thing in the content column, not a separate object beneath it, so it
    // starts on the content region's left edge — reached by centring the same
    // frame the shell uses and adding the sidebar back, rather than by
    // measuring from the left of the screen (which stops being the left of the
    // shell the moment the shell is centred).
    <footer className="mt-16 border-t border-border">
      <div className="shell-aligned flex flex-col gap-3 py-8 text-xs leading-relaxed text-ink-faint">
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
          <Link
            href="/legal"
            className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-ink md:min-h-0 md:min-w-0 md:justify-start"
          >
            Legal &amp; data sources
          </Link>
          <Link
            href="/docs/methodology"
            className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-ink md:min-h-0 md:min-w-0 md:justify-start"
          >
            Methodology
          </Link>
          <Link
            href="/docs"
            className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-ink md:min-h-0 md:min-w-0 md:justify-start"
          >
            API
          </Link>
          <Link
            href="/status"
            className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-ink md:min-h-0 md:min-w-0 md:justify-start"
          >
            Status
          </Link>
          <a
            href="https://github.com/insiderflow/insiderflow"
            className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-ink md:min-h-0 md:min-w-0 md:justify-start"
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
