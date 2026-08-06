"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Light/dark switch. Renders a stable placeholder until mounted: the
 * resolved theme is only knowable on the client, and painting the wrong
 * icon first would be a visible flicker on every page load.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("nav");
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";
  const label = mounted ? (isDark ? t("themeLight") : t("themeDark")) : t("themeToggle");

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md border border-border text-ink-muted transition-colors hover:bg-fill hover:text-ink",
        className,
      )}
    >
      {mounted && isDark ? (
        <Sun className="size-3.5" aria-hidden />
      ) : (
        <Moon className="size-3.5" aria-hidden />
      )}
    </button>
  );
}
