import { AlertTriangle, Scale } from "lucide-react";
import Link from "next/link";

import { SiteFooter } from "@/components/shell/site-footer";

export const metadata = {
  title: "Legal & data sources",
  description:
    "Where InsiderFlow's data comes from, the terms each source carries, and the disclaimers that apply.",
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
      {/* Self-link marked by a rule on hover, not by colour — this page's one
          accent belongs to the disclaimer, and a licence page that shouts in
          six places is a page nobody finishes. */}
      <h2 className="text-xl font-semibold tracking-tight text-ink">
        <a
          href={`#${id}`}
          className="inline-flex min-h-11 cursor-pointer items-center decoration-border underline-offset-4 hover:underline md:min-h-0"
        >
          {title}
        </a>
      </h2>
      <div className="flex flex-col gap-4 text-base leading-relaxed text-ink-muted">{children}</div>
    </section>
  );
}

/** Every outbound citation on this page reads the same: ink, hairline rule
 *  underneath, darkening on hover. No colour is spent on a footnote. */
const LINK_CLASS =
  "cursor-pointer text-ink underline decoration-border underline-offset-2 transition-colors hover:decoration-ink";

export default function LegalPage() {
  return (
    <>
      {/* 68ch. This page exists to be read end to end, which is a measure
          decision before it is a colour one — and a measure is a limit on
          the right, not a pair of equal margins. */}
      <main id="main" className="shell-fluid pt-20 pb-16">
        <div data-content-region className="flex max-w-[68ch] flex-col gap-10">
          <header className="rail-bleed flex flex-col gap-3 border-b border-border pb-8">
            <h1 className="text-3xl font-semibold tracking-tight text-ink">
              Legal &amp; data sources
            </h1>
            <p className="text-base leading-relaxed text-ink-muted">
              What this project publishes, where each piece of it comes from, and the terms
              attached. Written to be read, not to be clicked past.
            </p>
          </header>

          {/* The page's one accent. Everything below it is a citation; this is
            the only paragraph a reader must not skim past. */}
          <div className="surface-sunken flex items-start gap-3 rounded-lg p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden />
            <div className="text-sm leading-relaxed text-ink-muted">
              <p className="font-semibold text-ink">Not investment advice.</p>
              <p className="mt-1">
                Nothing on this site — data, classifications, scores, alerts, or UI — is investment
                advice, a recommendation, a solicitation, or an offer to buy or sell any security.
                InsiderFlow is not a broker-dealer, investment adviser, or fiduciary, and no
                adviser-client relationship is created by using it. Filings can be late, amended,
                incomplete, or simply wrong, and insider activity is not a reliable predictor of
                returns.{" "}
                <strong className="font-semibold text-ink">
                  Do your own research and consult a licensed professional before making investment
                  decisions.
                </strong>{" "}
                The authors and contributors accept no liability for decisions made using this
                software or its data.
              </p>
            </div>
          </div>

          <Section id="sec" title="SEC EDGAR (United States) — public domain">
            <p>
              US insider transactions come from Forms 3, 4, and 5 filed with the Securities and
              Exchange Commission and published through EDGAR. Works produced by the US federal
              government are not subject to copyright in the United States (17 U.S.C. § 105), and
              the SEC states that EDGAR filings are public information that may be freely used.
            </p>
            <p>
              <strong className="font-semibold text-ink">Fair access.</strong> The SEC requires
              automated traffic to identify itself with a descriptive User-Agent including a contact
              address, and to stay under 10 requests per second. InsiderFlow sends a configured{" "}
              <code className="rounded-sm bg-fill px-1 font-mono text-sm text-ink">
                EDGAR_USER_AGENT
              </code>{" "}
              on every request and rate-limits well below that ceiling. Anyone self-hosting must set
              their own contact address — see{" "}
              <a
                href="https://www.sec.gov/os/accessing-edgar-data"
                target="_blank"
                rel="noreferrer"
                className={LINK_CLASS}
              >
                the SEC&rsquo;s access policy
              </a>
              .
            </p>
            <p>
              <strong className="font-semibold text-ink">Attribution.</strong> Source data courtesy
              of the US Securities and Exchange Commission. The SEC does not endorse this project,
              and this project is not affiliated with or approved by the SEC.
            </p>
          </Section>

          <Section id="stock-act" title="Congressional disclosures — STOCK Act">
            <p>
              The Stock Act (Pub. L. 112-105) requires members of Congress to publicly disclose
              securities transactions over <span className="num">$1,000</span> within 45 days, on a
              periodic transaction report (PTR). These filings are public records.
            </p>
            <p>
              <strong className="font-semibold text-ink">Amounts are ranges.</strong> A PTR
              discloses a bracket (&ldquo;<span className="num">$1,001&ndash;$15,000</span>&rdquo;),
              never an exact figure. InsiderFlow stores and displays the bracket as filed and never
              synthesises a midpoint or point value, because the underlying document does not
              contain one.
            </p>
            <p>
              <strong className="font-semibold text-ink">The disclosure is the news.</strong>{" "}
              Because filers have 45 days, a transaction can surface here weeks after it happened. A
              filing made past that deadline is labelled <em>late</em> — a fact stated on the
              filing, not an accusation. Nothing here alleges wrongdoing by any filer.
            </p>
            <p>
              Provenance and the source-selection reasoning are documented in{" "}
              <a
                href="https://github.com/insiderflow/insiderflow/blob/main/docs/politicians.md"
                target="_blank"
                rel="noreferrer"
                className={LINK_CLASS}
              >
                docs/politicians.md
              </a>
              .
            </p>
          </Section>

          <Section id="india" title="NSE / BSE (India) — restricted, not redistributed">
            <p>
              Indian insider disclosures (SEBI Prohibition of Insider Trading regulations, SAST
              Regulations 29–31, bulk and block deals, promoter pledges) are published by the
              National Stock Exchange and BSE. Unlike EDGAR, this data is{" "}
              <strong className="font-semibold text-ink">not in the public domain</strong>: both
              exchanges assert copyright and their website terms restrict automated access,
              extraction, and redistribution.
            </p>
            <p>
              <strong className="font-semibold text-ink">
                The hosted reference deployment therefore does not scrape NSE or BSE, and
                redistributes no Indian exchange data.
              </strong>{" "}
              The India adapter ships disabled. A self-hoster may enable it, and does so under their
              own legal responsibility.
            </p>
            <p>
              <strong className="font-semibold text-ink">India IT Act § 43.</strong> Accessing a
              computer resource without the owner&rsquo;s permission, or downloading data from it,
              can attract civil liability under § 43 of the Information Technology Act, 2000, with §
              66 providing criminal liability where the act is dishonest or fraudulent. Whether
              routine scraping of a public webpage in breach of its terms falls within these
              provisions has not been settled by Indian courts. That uncertainty is the reason this
              project defaults to off rather than treating it as obviously permitted.
            </p>
            <p>
              The lower-risk route is a licensed data feed: set{" "}
              <code className="rounded-sm bg-fill px-1 font-mono text-sm text-ink">
                INDIA_FEED_URL
              </code>{" "}
              to a source you are licensed to use, and the same normalizer handles it. See{" "}
              <a
                href="https://github.com/insiderflow/insiderflow/blob/main/ingestion/india-local/README.md"
                target="_blank"
                rel="noreferrer"
                className={LINK_CLASS}
              >
                ingestion/india-local/README.md
              </a>{" "}
              for the full risk summary.
            </p>
          </Section>

          <Section id="market-data" title="Prices, FX, and third-party APIs">
            <p>
              Daily closing prices come from Stooq and foreign-exchange rates from the Frankfurter
              API (European Central Bank reference rates). Both are used without an API key and
              cached locally so the same value is never fetched twice.
            </p>
            <p>
              Optional enrichment from Finnhub and Financial Modeling Prep is off unless an operator
              supplies their own API key, in which case that operator&rsquo;s agreement with the
              provider governs the use. Prices are indicative and may be delayed, adjusted, or
              wrong; this is not a market data feed.
            </p>
          </Section>

          <Section id="analytics" title="Derived analytics">
            <p>
              Clusters, sector classifications, performance scores, and anomaly scores are computed
              by this project from the sources above, using formulas published in full at{" "}
              <Link href="/docs/methodology" className={LINK_CLASS}>
                /docs/methodology
              </Link>
              . They are backward-looking descriptive statistics over past filings. They are not
              predictions, not ratings, and not an opinion about any security or person.
            </p>
            <p>
              Sector labels are derived from SEC SIC codes by an opinionated mapping documented on
              that page — not by a standards body, and not by GICS, which is licensed and cannot be
              redistributed in an AGPL project.
            </p>
          </Section>

          <Section id="privacy" title="Accounts and data we hold">
            <p>
              Accounts are optional; the entire site is usable signed out. When you do sign in,
              Supabase Auth holds your identity and this application stores only what a feature
              needs: watchlist entries, alert rules, a Telegram chat id or email address for
              delivery, and a log of alerts sent to you. There is no advertising, no third-party
              analytics, and no sale or sharing of user data.
            </p>
            <p>
              Alert emails carry one-click unsubscribe (RFC 8058). Unsubscribing disables email
              delivery immediately and removes email from your rules; Telegram is unaffected.
            </p>
          </Section>

          <Section id="licence" title="Licence and warranty">
            <p>
              InsiderFlow is free software licensed under the{" "}
              <a
                href="https://www.gnu.org/licenses/agpl-3.0.html"
                target="_blank"
                rel="noreferrer"
                className={LINK_CLASS}
              >
                GNU Affero General Public License v3.0
              </a>
              . If you run a modified version as a network service, the AGPL requires you to offer
              your users the corresponding source.
            </p>
            <p className="flex items-start gap-2">
              <Scale className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
              <span>
                The software is provided <strong className="font-semibold text-ink">as is</strong>,
                without warranty of any kind, express or implied, including but not limited to the
                warranties of merchantability, fitness for a particular purpose, and
                non-infringement. The licence text governs; this page is a summary, not a substitute
                for it.
              </span>
            </p>
            <p>
              The licence covers the software. It does not grant rights over third-party data
              accessed through it — each source&rsquo;s own terms continue to apply, which is the
              whole point of the sections above.
            </p>
          </Section>

          <Section id="contact" title="Corrections">
            <p>
              This project republishes other people&rsquo;s filings. If something here misrepresents
              a filing, or a person appears in a record that is not theirs, open an issue on{" "}
              <a
                href="https://github.com/insiderflow/insiderflow/issues"
                target="_blank"
                rel="noreferrer"
                className={LINK_CLASS}
              >
                GitHub
              </a>{" "}
              and it will be corrected. Where the underlying filing itself is wrong, the correction
              belongs with the filer and the regulator — but the record here should always match
              what was actually filed.
            </p>
          </Section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
