"use client";

import { Activity, BookOpen, Building2, Flame, LayoutGrid, ScanSearch, Table2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  soon?: boolean;
}

/** Phase 6 product pages are declared now and land later — the shell is ready for them. */
const NAV: Array<{ heading: string; items: NavItem[] }> = [
  {
    heading: "App",
    items: [
      { label: "Overview", href: "/", icon: Activity },
      { label: "Trades", href: "/trades", icon: Table2, soon: true },
      { label: "Screens", href: "/screens", icon: ScanSearch, soon: true },
      { label: "Heatmap", href: "/heatmap", icon: Flame, soon: true },
      { label: "Companies", href: "/companies", icon: Building2, soon: true },
    ],
  },
  {
    heading: "Reference",
    items: [
      { label: "Design system", href: "/design", icon: LayoutGrid },
      { label: "API docs", href: "/docs", icon: BookOpen },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 flex-col gap-6 overflow-y-auto border-r border-white/6 px-3 py-6 lg:flex">
      {NAV.map((section) => (
        <nav key={section.heading} aria-label={section.heading}>
          <p className="mb-2 px-2.5 text-2xs font-semibold uppercase tracking-widest text-subtle-foreground">
            {section.heading}
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
                      {item.label}
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
                    {item.label}
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
