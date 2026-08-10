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

export interface NavItem {
  /** Message key under nav.items — never a literal string. */
  key: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  soon?: boolean;
}

/**
 * The one nav definition. The sidebar and the full-screen overlay are two
 * presentations of this list — duplicating it is how they drift apart.
 */
export const NAV: Array<{ section: string; items: NavItem[] }> = [
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

/**
 * Which single nav entry owns the current URL.
 *
 * Exact matching was wrong in both directions: /politicians/42 lit nothing,
 * so a detail page looked like it belonged to no section, while a naive
 * prefix match lit BOTH /docs and /docs/methodology at once. Two current
 * pages is not a navigation aid, and `aria-current="page"` on two links is
 * a lie a screen reader repeats out loud.
 *
 * So: prefix match on a path SEGMENT boundary, then keep the longest hit.
 * The longest match is the most specific one, which is the one a reader
 * would point at.
 *
 * Returns null where no entry owns the route — /stock/AAPL genuinely lives
 * under no section, and marking a nearby one would be a guess dressed up
 * as a fact.
 */
export function activeNavHref(pathname: string): string | null {
  let best: string | null = null;
  for (const section of NAV) {
    for (const item of section.items) {
      if (item.soon) continue;
      const hit =
        item.href === "/"
          ? pathname === "/"
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (hit && (best === null || item.href.length > best.length)) best = item.href;
    }
  }
  return best;
}
