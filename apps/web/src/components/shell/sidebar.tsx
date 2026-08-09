"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

import { BrandLink } from "./brand";
import { activeNavHref, NAV } from "./nav-items";

/**
 * The index, and — since r6 — the product's identity.
 *
 * The brand used to live in the masthead, pinned to the viewport's left
 * edge while the page's own H1 started at the content gutter: two left
 * edges on one screen. Moving it here gives the app shell exactly one,
 * and it is the pattern the shape already implies — shadcn/ui's
 * SidebarHeader is documented as the place for branding, and Catalyst,
 * GitHub, Linear, Slack and Vercel all put the mark in the corner of the
 * sidebar rather than in a bar floating above it.
 *
 * So the column now runs the full height of the viewport, from y=0, and
 * its header rule continues the masthead's rule across the screen. It is
 * still NOT a nav item: no `aria-current`, no accent rule, no tinted
 * ground — the three signals that mean "you are here" belong to the
 * eleven links below it and to nothing else.
 */
export function Sidebar() {
  const pathname = usePathname();
  const activeHref = activeNavHref(pathname);
  const t = useTranslations("nav");
  // `apiDocs` lives at nav.apiDocs (shared with the top bar); the rest are
  // under nav.items.
  const itemLabel = (key: string) => (key === "apiDocs" ? t("apiDocs") : t(`items.${key}`));

  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col overflow-y-auto border-r border-border lg:flex">
      {/* `--shell-nav-inset` is the distance from the sidebar's edge to a
          nav item's CONTENT (12px padding + a 2px state rule + 10px), so
          the mark and the eleven glyphs beneath it stand on one line.
          `h-14` matches the masthead exactly: the two bottom rules meet
          and read as one line across the top of the window. */}
      {/* `data-sidebar-brand`: this block is the left-hand quarter of the
          masthead bar, so globals.css gives it the same ground and the same
          hairline. Without that the band across the top of the window steps
          tone at the sidebar's right edge. */}
      <div
        data-sidebar-brand
        className="flex h-14 shrink-0 items-center border-b"
        style={{ paddingInlineStart: "var(--shell-nav-inset)" }}
      >
        <BrandLink />
      </div>

      <div className="flex flex-col gap-7 px-3 py-6">
        {NAV.map((section) => (
          <nav key={section.section} aria-label={t(`sections.${section.section}`)}>
            <p className="mb-2 px-2.5 text-2xs font-semibold text-ink-faint">
              {t(`sections.${section.section}`)}
            </p>
            <ul className="flex flex-col">
              {section.items.map((item) => {
                const active = item.href === activeHref;
                const Icon = item.icon;
                if (item.soon) {
                  return (
                    <li key={item.href}>
                      <span
                        aria-disabled
                        className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-ink-faint"
                      >
                        <Icon className="size-4" aria-hidden />
                        {itemLabel(item.key)}
                        <span className="ml-auto rounded-sm border border-border px-1 text-2xs text-ink-faint">
                          soon
                        </span>
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        // Three signals, because one is not enough: the accent
                        // rule in the margin, a tinted ground, and heavier ink.
                        // A rule alone was too quiet to find at a glance in a
                        // list of eleven, and it read as decoration rather than
                        // as state. `aria-current` carries the same fact to
                        // anyone not looking at it.
                        "flex items-center gap-2.5 border-l-2 py-1.5 pr-2.5 pl-2.5 text-sm transition-colors",
                        active
                          ? "border-l-accent-bright bg-fill font-medium text-ink"
                          : "border-l-transparent text-ink-muted hover:border-l-border hover:bg-fill/60 hover:text-ink",
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                      {itemLabel(item.key)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ))}
      </div>
    </aside>
  );
}
