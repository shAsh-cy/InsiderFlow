import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { buildString } from "@/lib/build-info";

const REPO = "https://github.com/insiderflow/insiderflow";
const LICENCE = "https://www.gnu.org/licenses/agpl-3.0.html";

/**
 * The landing page's footer, and the landing page's only.
 *
 * App routes keep `SiteFooter`, which exists for one reason — the "not
 * investment advice" line has to be on every page, because any page can be
 * the first one somebody lands on from a search result. This is the
 * different job: the landing page is where the project says what it is,
 * under whose licence, and where the source lives.
 *
 * The source link is not decoration. AGPL-3.0 §13 requires that users
 * interacting with the software over a network are offered the
 * Corresponding Source through the interface itself, so a repository link
 * in the footer of a network-served AGPL application is a licence term,
 * not a courtesy.
 *
 * "Not investment advice" moved here out of the hero. It was a bordered
 * block with `role="alert"` under the primary call to action: announced on
 * page load by every screen reader, and visually the fourth thing between
 * the headline and the tape. The claim is not less true at the bottom of
 * the page; it is just no longer standing in front of the product.
 *
 * The whole thing sits inside the landing's own content region, so its
 * left edge is the hero's left edge with nothing to keep in sync.
 */
export async function LandingFooter() {
  const t = await getTranslations("landing.footer");

  const links: Array<{ label: string; href: string; external?: boolean }> = [
    { label: t("links.source"), href: REPO, external: true },
    { label: t("links.licence"), href: LICENCE, external: true },
    // One link, not two: /docs IS the API reference in this product, and a
    // separate "API" entry pointing at the same page is a second name for
    // one destination — the redundancy r3 took out of the top bar.
    { label: t("links.apiDocs"), href: "/docs" },
    { label: t("links.methodology"), href: "/docs/methodology" },
    { label: t("links.status"), href: "/status" },
    { label: t("links.legal"), href: "/legal" },
  ];

  return (
    <footer className="border-t border-border pt-8 pb-14">
      <div className="flex flex-col gap-6">
        <nav
          aria-label={t("navLabel")}
          className="flex flex-wrap gap-x-5 gap-y-0.5 text-xs text-ink-muted"
        >
          {links.map((link) =>
            link.external ? (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                // 44px on a phone, back to a text row from md — the same
                // shape every link list in this product uses.
                className="inline-flex min-h-11 items-center transition-colors hover:text-ink md:min-h-0"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className="inline-flex min-h-11 items-center transition-colors hover:text-ink md:min-h-0"
              >
                {link.label}
              </Link>
            ),
          )}
        </nav>

        {/* The testid spans every honesty paragraph: the disclaimer first,
            then provenance, then the licence line. `ship.spec` asserts the
            substance rather than one wording. */}
        <div
          data-testid="footer-disclaimer"
          className="flex flex-col gap-3 text-xs leading-relaxed text-ink-faint"
        >
          <p className="max-w-[80ch]">
            <strong className="font-semibold text-ink-muted">{t("disclaimerLead")}</strong>{" "}
            {t("disclaimerBody")}
          </p>
          <p className="max-w-[80ch]">
            <strong className="text-ink-muted">{t("sourcesLead")}</strong> {t("sourcesBody")}
          </p>
          <p className="max-w-[80ch]">{t("licence")}</p>
        </div>

        {/* The build, in the mono face because it is a version string and
            that is the one thing mono is for here. It prints a commit only
            when the build actually knew one — see lib/build-info. */}
        <p
          data-testid="build-string"
          className="num border-t border-border pt-4 text-2xs text-ink-faint"
        >
          {buildString()}
          {" · AGPL-3.0"}
        </p>
      </div>
    </footer>
  );
}
