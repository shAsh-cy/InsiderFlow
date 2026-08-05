"use client";

/**
 * Locale switcher. Writes the locale cookie and refreshes, so the server
 * re-renders with the new catalogue — no client-side message bundle swap and
 * no route change (see src/i18n/config.ts for the routing decision).
 */
import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { LOCALE_COOKIE, LOCALE_LABELS, LOCALES } from "@/i18n/config";
import type { Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

export function LocaleSwitcher({ className }: { className?: string }) {
  const active = useLocale();
  const router = useRouter();
  const t = useTranslations("nav");
  const [pending, startTransition] = useTransition();

  const select = (locale: Locale) => {
    // One year, site-wide, lax — a display preference, not a credential.
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  };

  return (
    <div
      role="group"
      aria-label={t("language")}
      className={cn("glass inline-flex h-8 items-center rounded-lg px-1", className)}
    >
      <Languages className="mx-1.5 size-3.5 text-subtle-foreground" aria-hidden />
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          onClick={() => select(locale)}
          disabled={pending}
          aria-pressed={active === locale}
          className={cn(
            "rounded-md px-1.5 py-0.5 text-xs transition-colors disabled:opacity-60",
            active === locale
              ? "bg-white/8 font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LOCALE_LABELS[locale]}
        </button>
      ))}
    </div>
  );
}
