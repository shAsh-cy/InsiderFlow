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
 * r6 put every link in a single narrow left-hand column, which at 1920
 * left the right two thirds of the band empty — a footer that had stopped
 * using the page it sits on. r7 made it an index; r8 took the brand column
 * back out of that index, because a mark, a wordmark and a tagline in the
 * first cell was a third repetition of an identity the masthead already
 * holds. The shape here is the ordinary one because it is ordinary for
 * good reasons: a grid of short labelled groups is scannable without being
 * read, and grouping gives the destinations a hierarchy a flat row cannot.
 *
 * Three bands, separated by hairlines, each a different kind of statement
 * and each with its own measure: the index (three groups spread across the
 * shell), the fine print (two paragraphs at a multi-column measure — see
 * below), and the meta row (the mark at icon scale beside the build).
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
          Three groups, spread across the shell, 3 → 2 → 1, on the shared
          `.footer-row` template every band in this footer rides.

          r9 spread the TRACKS and left the ink hugging the left of each
          one, which at 1920 put Reference's last character 448px short of
          the shell's right edge. r9.2 spreads the groups themselves —
          `space-between` on shrink-to-fit items — so the first group's ink
          opens on the left edge and the last group's ink closes on the
          right. What does NOT change is the text inside them: every
          heading and every link is left-aligned against its own group,
          because reaching an outer edge by right-aligning a link list buys
          that edge and spends the inner one.

          r7 gave the first column to the mark, the wordmark and a tagline.
          That was a third repetition of an identity the masthead is already
          holding two screens above, and the tagline was a paraphrase of the
          hero's own subhead one screen above that. What it bought was a
          quarter of the index spent on saying the product's name again;
          what it cost was the three groups being squeezed into the
          remaining three quarters. The mark is still in the footer — it is
          in the meta row, at icon scale, where a compact mark belongs. */}
      <div className="footer-row gap-y-10">
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
          TWO paragraphs, one on each shell edge.

          r7 capped these at 66ch and left them stacked, which put the whole
          band in a single column against the left gutter with the right
          half of a 1792px band empty. 66ch was the right principle read off
          the wrong line of Bringhurst: it is his figure for a SINGLE
          column, and for multi-column setting he gives 40–50. So the
          measure moves with the layout — two blocks at a multi-column
          measure, one keyed to each gutter.

          `text-xs` (12px) and not `text-2xs` (11px): reduced, but not below
          the size Lighthouse's legible-font-size audit — and the reason
          behind it — treats as readable. At 11px this band was enough of
          the landing's text to take mobile best-practices from 100 to 96.
          `leading-normal` is 1.5, which is the line-height fine print is
          set at when anyone bothers to specify one.

          The testid spans both paragraphs — `ship.spec` asserts the
          substance rather than one wording. */}
      <div
        data-testid="footer-disclaimer"
        className="footer-row footer-band gap-y-3 text-xs leading-normal text-ink-faint"
      >
        {/* First item, so it opens on the shell's left edge — the same
            edge Product opens on above it. */}
        <p className="footer-span-lead max-w-[50ch]">
          <strong className="font-semibold text-ink-muted">{t("disclaimerLead")}</strong>{" "}
          {t("disclaimerBody")}
        </p>
        {/* Last item, so it closes on the shell's right edge — the same
            edge Reference closes on above it. r8 put this at the band's
            own midpoint, a line nothing else in the footer used, which is
            the whole of what made the footer read as two objects; r9 moved
            it onto the index's third track, which stopped being a line the
            index used the moment the index stopped having tracks. The BOX
            is what moves. The text inside it stays left-aligned: a
            multi-line paragraph set ragged-left is a defect, not a
            style. */}
        <p className="footer-span-trail max-w-[50ch]">
          <strong className="font-semibold text-ink-muted">{t("sourcesLead")}</strong>{" "}
          {t("sourcesBody")}
        </p>
      </div>

      {/* ── The build ──────────────────────────────────────────────────
          Its own row, spanning the shell. Mono, because it is a version
          string and that is the one thing mono is for here, with tabular
          figures from the `num` class. It prints a commit only when the
          build actually knew one — see lib/build-info. */}
      {/* Same rhythm as the band above it — `.footer-band` carries the rule
          and the spacing on both, so the two dividers cannot drift apart. */}
      <div className="footer-band flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* The mark at icon scale, not the masthead's box. Deliberately NOT
            a link and NOT `data-brand`: the masthead carries the one
            navigational brand on this page, and a second link home at the
            bottom is a second answer to a question nobody asked twice.
            Here it is a signature on the build line — the thing a compact
            mark is for. */}
        <p
          data-testid="footer-mark"
          className="flex shrink-0 items-center gap-2 text-xs font-semibold tracking-tight text-ink"
        >
          <BrandMark className="size-4" />
          InsiderFlow
        </p>
        <p data-testid="build-string" className="num text-2xs text-ink-faint">
          {buildString()}
          {" · AGPL-3.0"}
        </p>
      </div>
    </footer>
  );
}
