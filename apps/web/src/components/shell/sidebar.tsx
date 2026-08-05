"use client";

import {
  Activity,
  BookOpen,
  Building2,
  Flame,
  Landmark,
  LayoutGrid,
  ScanSearch,
  Sigma,
  Star,
  Table2,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

interface NavItem {
  /** Message key under nav.items — never a literal string. */
  key: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  soon?: boolean;
}

const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: "app",
    items: [
      { key: "overview", href: "/", icon: Activity },
      { key: "liveFeed", href: "/trades", icon: Table2 },
      { key: "screener", href: "/screener", icon: ScanSearch },
      { key: "companies", href: "/companies", icon: Building2 },
      { key: "watchlist", href: "/watchlist", icon: Star },
      { key: "heatmap", href: "/heatmap", icon: Flame },
    ],
  },
  {
    section: "analytics",
    items: [
      { key: "leaderboard", href: "/leaderboard", icon: Trophy },
      { key: "politicians", href: "/politicians", icon: Landmark },
    ],
  },
  {
    section: "reference",
    items: [
      { key: "methodology", href: "/docs/methodology", icon: Sigma },
      { key: "designSystem", href: "/design", icon: LayoutGrid },
      { key: "apiDocs", href: "/docs", icon: BookOpen },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  // `apiDocs` lives at nav.apiDocs (shared with the top bar); the rest are
  // under nav.items.
  const itemLabel = (key: string) => (key === "apiDocs" ? t("apiDocs") : t(`items.${key}`));

  return (
    <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 flex-col gap-6 overflow-y-auto border-r border-white/6 px-3 py-6 lg:flex">
      {NAV.map((section) => (
        <nav key={section.section} aria-label={t(`sections.${section.section}`)}>
          <p className="mb-2 px-2.5 text-2xs font-semibold uppercase tracking-widest text-subtle-foreground">
            {t(`sections.${section.section}`)}
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              if (item.soon) {
                return (
                  <li key={item.href}>
                    <span
                      aria-disabled
                      className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-subtle-foreground/60"
                    >
                      <Icon className="size-4" aria-hidden />
                      {itemLabel(item.key)}
                      <span className="ml-auto rounded border border-white/8 px-1 text-2xs uppercase text-subtle-foreground">
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
                      "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-white/6 font-medium text-foreground"
                        : "text-muted-foreground hover:bg-white/4 hover:text-foreground",
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
