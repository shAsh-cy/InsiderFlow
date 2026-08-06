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
