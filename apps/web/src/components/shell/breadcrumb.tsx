"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A breadcrumb for the two routes that are genuinely deep.
 *
 * /stock/[ticker] and /insider/[id] are the only pages in the product you
 * arrive at from somewhere else and can be several links from anything in
 * the index — the sidebar highlights nothing for them, by design, because
 * no section owns them. Every other route IS a sidebar entry, and a
 * breadcrumb there would restate what the left-hand accent bar already
 * says.
 *
 * The trail is set by the PAGE rather than derived from the pathname. That
 * is not incidental: the entity crumb is a company's ticker or a person's
 * name, and only the server rendering the page knows either. Deriving it
 * from the URL would print a numeric id at an insider, and adding a
 * pathname table here would be a second place that has to learn about
 * every new route.
 *
 * The section label is resolved through the same nav catalogue the sidebar
 * reads, so the crumb and the item it points at are translated by one
 * string rather than by two that can disagree.
 */
export interface BreadcrumbTrail {
  /** A key under `nav.items` — the section this entity belongs to. */
  sectionKey: string;
  sectionHref: string;
  /** The entity's own display name. Already canonical; never an id. */
  entity: string;
  /** Tickers and codes are set in mono; a person's name is not. */
  mono?: boolean;
}

const BreadcrumbContext = createContext<{
  trail: BreadcrumbTrail | null;
  setTrail: (trail: BreadcrumbTrail | null) => void;
}>({ trail: null, setTrail: () => {} });

/**
 * Wraps the masthead AND the page, because the trail travels upward: the
 * page knows the entity, the bar draws it. State lives above both.
 */
export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [trail, setTrail] = useState<BreadcrumbTrail | null>(null);
  const value = useMemo(() => ({ trail, setTrail }), [trail]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

/**
 * Rendered by a deep page. Draws nothing itself.
 *
 * Cleared on unmount, so navigating from /stock/AAPL to /trades does not
 * leave a crumb pointing at a page you are no longer on — a stale
 * breadcrumb is worse than none, because it is a claim about where you are.
 */
export function SetBreadcrumb({ trail }: { trail: BreadcrumbTrail }) {
  const { setTrail } = useContext(BreadcrumbContext);
  const key = `${trail.sectionKey}|${trail.sectionHref}|${trail.entity}|${trail.mono ?? false}`;
  useEffect(() => {
    setTrail(trail);
    return () => setTrail(null);
    // Keyed on the VALUES, not the object: a server component hands down a
    // fresh literal on every render and an object dep would reset the
    // state on each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setTrail]);
  return null;
}

/** The trail itself, drawn in the masthead's content region. */
export function Breadcrumbs({ className }: { className?: string }) {
  const { trail } = useContext(BreadcrumbContext);
  const t = useTranslations("nav");
  if (!trail) return null;

  const crumbs = [
    { label: t("items.overview"), href: "/", mono: false },
    { label: t(`items.${trail.sectionKey}`), href: trail.sectionHref, mono: false },
  ];

  return (
    <nav
      aria-label={t("breadcrumb")}
      data-testid="breadcrumb"
      // Below `md` the bar is already carrying a menu trigger, the mark and
      // three controls; there is no width left, and the page's own H1 is
      // one scroll away.
      className={cn("hidden min-w-0 md:flex", className)}
    >
      <ol className="flex min-w-0 items-center gap-1.5 text-xs">
        {crumbs.map((crumb) => (
          <li key={crumb.href} className="flex shrink-0 items-center gap-1.5">
            <Link href={crumb.href} className="text-ink-muted transition-colors hover:text-ink">
              {crumb.label}
            </Link>
            <span aria-hidden className="text-ink-faint">
              /
            </span>
          </li>
        ))}
        <li className="min-w-0">
          {/* `aria-current="page"`, and NOT a link: the last crumb is where
              you already are, and a link to the current page is a control
              that does nothing. */}
          <span
            aria-current="page"
            className={cn("block truncate font-medium text-ink", trail.mono && "num")}
          >
            {trail.entity}
          </span>
        </li>
      </ol>
    </nav>
  );
}
