"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

import { NAV } from "./nav-items";

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  // `apiDocs` lives at nav.apiDocs (shared with the top bar); the rest are
  // under nav.items.
  const itemLabel = (key: string) => (key === "apiDocs" ? t("apiDocs") : t(`items.${key}`));

  return (
    <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 flex-col gap-7 overflow-y-auto border-r border-border px-3 py-6 lg:flex">
      {NAV.map((section) => (
        <nav key={section.section} aria-label={t(`sections.${section.section}`)}>
          <p className="mb-2 px-2.5 text-2xs font-semibold text-ink-faint">
            {t(`sections.${section.section}`)}
          </p>
          <ul className="flex flex-col">
            {section.items.map((item) => {
              const active = pathname === item.href;
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
                      // The active item is marked by an oxblood margin rule,
                      // the way a reader marks a page — not by a filled pill.
                      "flex items-center gap-2.5 border-l-2 py-1.5 pl-2.5 pr-2.5 text-sm transition-colors",
                      active
                        ? "border-l-accent-bright font-medium text-ink"
                        : "border-l-transparent text-ink-muted hover:border-l-border hover:text-ink",
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
    </aside>
  );
}
