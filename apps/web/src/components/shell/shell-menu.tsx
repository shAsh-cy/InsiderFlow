"use client";

/**
 * The masthead's overflow menu, below md.
 *
 * The bar carries five things at 360px — hamburger, brand, search, this,
 * and sign-in — and that is already the whole width. Language, theme and
 * Settings apply to every page, so they fold in here rather than being
 * dropped: r3 hid the language switcher behind `sm:` and it was the ONLY
 * mount point in the app, so a reader on a phone could not choose Hindi,
 * and a reader who had chosen Hindi on a desktop was locked into it with
 * no way back.
 *
 * One home each. These controls are not repeated in the navigation drawer;
 * the drawer is the index, this is the controls.
 */
import { MoreHorizontal, Settings2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";

export function ShellMenu({
  className,
  showSettings,
  settingsActive,
}: {
  className?: string;
  showSettings: boolean;
  settingsActive: boolean;
}) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={t("more")}
        data-testid="shell-overflow"
        className={cn(
          // 44px of hit area with no drawn box: at this size a bordered
          // square would be the heaviest object in a 56px bar, and the bar
          // already has a bordered square in it (the brand).
          "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-fill hover:text-ink",
          className,
        )}
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2" data-testid="shell-overflow-menu">
        <div className="flex min-h-11 items-center justify-between gap-3 px-2">
          <span className="text-xs text-ink-muted">{t("language")}</span>
          <LocaleSwitcher />
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border px-2">
          <span className="text-xs text-ink-muted">{t("theme")}</span>
          <ThemeToggle />
        </div>
        {showSettings ? (
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            aria-current={settingsActive ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-2.5 border-t border-border px-2 text-xs transition-colors",
              settingsActive ? "font-semibold text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            <Settings2 className="size-4" aria-hidden />
            {t("settings")}
          </Link>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
