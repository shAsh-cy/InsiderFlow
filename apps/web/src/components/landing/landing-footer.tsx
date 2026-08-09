import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BrandMark } from "@/components/shell/brand";
import { buildString } from "@/lib/build-info";

const REPO = "https://github.com/insiderflow/insiderflow";
const LICENCE = "https://www.gnu.org/licenses/agpl-3.0.html";

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

/**
 * The landing page's footer, and the landing page's only.
 *
 * App routes keep `SiteFooter`, which exists for one reason — the "not
 * investment advice" line has to be on every page, because any page can be
 * the first one somebody lands on from a search result. This is the
 * different job: the landing page saying what the project IS, under whose
 * licence, and where the source lives.
 *
 * r7 rebuilt it as a four-column index. r6 put every link in a single
 * narrow left-hand column, which at 1920 left the right two thirds of the
 * band empty — a footer that had stopped using the page it sits on. The
 * shape here is the ordinary one because it is ordinary for good reasons:
 * a grid of short labelled groups is scannable without reading, and it
 * gives the destinations a hierarchy that a flat row of six cannot.
 *
 * Three bands, separated by hairlines: the index, the fine print, the
 * build. Each is a different kind of statement and each gets its own
 * measure — the fine print is capped at 66ch because it is the only part
 * anyone reads as prose.
 *
 * The source link is not decoration. AGPL-3.0 §13 requires that users
 * interacting with the software over a network are offered the
 * Corresponding Source through the interface itself, so a repository link
 * in the footer of a network-served AGPL application is a licence term.
 *
 * The whole thing sits inside the landing's own content region, so its
 * left edge is the hero's left edge with nothing to keep in sync.
 */
export async function LandingFooter() {
  const t = await getTranslations("landing.footer");

  const groups: Array<{ label: string; links: FooterLink[] }> = [
    {
      label: t("groups.product"),
      links: [
        { label: t("links.liveTape"), href: "/trades" },
        { label: t("links.screener"), href: "/screener" },
        { label: t("links.heatmap"), href: "/heatmap" },
        { label: t("links.leaderboard"), href: "/leaderboard" },
      ],
    },
    {
      label: t("groups.project"),
      links: [
        { label: t("links.source"), href: REPO, external: true },
        { label: t("links.licence"), href: LICENCE, external: true },
        { label: t("links.methodology"), href: "/docs/methodology" },
        { label: t("links.status"), href: "/status" },
      ],
    },
    {
      label: t("groups.reference"),
      links: [
        // One entry, not two: /docs IS the API reference in this product,
        // and a separate "Docs" pointing at the same page is a second name
        // for one destination — the redundancy r3 took out of the top bar.
        { label: t("links.apiDocs"), href: "/docs" },
        { label: t("links.legal"), href: "/legal" },
      ],
    },
  ];

  return (
    <footer className="border-t border-border pt-10 pb-14">
      {/* ── The index ──────────────────────────────────────────────────
          4 → 2 → 1. The brand is a column of the grid rather than a banner
          above it, so the groups start on the same baseline as the mark and
          the band reads as one object. */}
      <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3">
          {/* Deliberately NOT a link and NOT `data-brand`. The masthead
              already carries the one navigational brand on this page; a
              second link home two screens below it is a second answer to a
              question nobody asked twice. */}
          <p className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-ink">
            <BrandMark />
            InsiderFlow
          </p>
          <p className="max-w-[28ch] text-xs leading-relaxed text-ink-muted">{t("tagline")}</p>
        </div>

        {groups.map((group) => (
          <nav key={group.label} aria-label={group.label} className="flex flex-col gap-3">
            {/* Uppercase in the SANS face, not mono: mono here is reserved
                for figures, tickers and codes, and uppercase mono is not
                structural chrome in this system. */}
            <p className="text-2xs font-semibold tracking-wider text-ink-faint uppercase">
              {group.label}
            </p>
            <ul className="flex flex-col gap-0.5 text-xs text-ink-muted">
              {group.links.map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      // `noreferrer` implies `noopener`: a target=_blank
                      // without it hands the opened page a handle on this one.
                      rel="noreferrer"
                      // 44x44 on a phone, back to a text row from md — the
                      // same shape every link list in this product uses.
                      // `min-w-11` is not decoration: "Source" and "Status"
                      // are 40px and 37px of text, so height alone leaves
                      // both short of the AAA target size. Left-aligned
                      // rather than centred, because this is a column.
                      className="inline-flex min-h-11 min-w-11 items-center transition-colors hover:text-ink md:min-h-0 md:min-w-0 md:py-1"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      href={link.href}
                      className="inline-flex min-h-11 min-w-11 items-center transition-colors hover:text-ink md:min-h-0 md:min-w-0 md:py-1"
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      {/* ── The fine print ─────────────────────────────────────────────
          Full-width band, but the paragraphs are capped at 66ch. The
          measure is the point: this is the only part of the footer read as
          prose, and a 150-character line of legal text is a line nobody
          finishes. The testid spans both paragraphs — `ship.spec` asserts
          the substance rather than one wording. */}
      <div
        data-testid="footer-disclaimer"
        className="mt-10 flex flex-col gap-3 border-t border-border pt-6 text-2xs leading-relaxed text-ink-faint"
      >
        <p className="max-w-[66ch]">
          <strong className="font-semibold text-ink-muted">{t("disclaimerLead")}</strong>{" "}
          {t("disclaimerBody")}
        </p>
        <p className="max-w-[66ch]">
          <strong className="font-semibold text-ink-muted">{t("sourcesLead")}</strong>{" "}
          {t("sourcesBody")}
        </p>
      </div>

      {/* ── The build ──────────────────────────────────────────────────
          Mono, because it is a version string and that is the one thing
          mono is for here. It prints a commit only when the build actually
          knew one — see lib/build-info. */}
      <div className="mt-6 border-t border-border pt-4">
        <p data-testid="build-string" className="num text-2xs text-ink-faint">
          {buildString()}
          {" · AGPL-3.0"}
        </p>
      </div>
    </footer>
  );
}
