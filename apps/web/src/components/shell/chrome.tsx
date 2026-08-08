"use client";

/**
 * The masthead.
 *
 * Both heavy overlays — the ⌘K palette and the full-screen nav — are
 * code-split: cmdk, the dialog primitives and the motion runtime only
 * download once someone actually reaches for them, keeping all of it off
 * the landing page's critical path.
 *
 * The bar itself is opaque rather than translucent-and-blurred. A blurred
 * fixed header forces the compositor to re-sample everything beneath it
 * on every scroll frame, and paper does not blur anyway.
 */
import { Menu, Search } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { LocaleSwitcher } from "./locale-switcher";
import type { SessionInfo } from "./session-provider";
import { ThemeToggle } from "./theme-toggle";

const CommandPalette = dynamic(() => import("./command-palette"), { ssr: false });
const NavOverlay = dynamic(() => import("./nav-overlay"), { ssr: false });

export function ShellChrome({ session }: { session?: SessionInfo }) {
  const t = useTranslations("nav");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Stays true after first open so the chunk isn't re-requested. */
  const [paletteLoaded, setPaletteLoaded] = useState(false);
  const [menuLoaded, setMenuLoaded] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteLoaded(true);
        setPaletteOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const openPalette = () => {
    setPaletteLoaded(true);
    setPaletteOpen(true);
  };

  const openMenu = () => {
    setMenuLoaded(true);
    setMenuOpen(true);
  };

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-bg">
        {/* Full-bleed, and padded to 24px so the brand lands on exactly the
            x the sidebar's own item labels start from. */}
        <div className="flex h-14 items-center gap-3 px-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-ink"
          >
            {/* The mark: an oxblood ledger tab, not a glowing orb. */}
            <span aria-hidden className="h-3.5 w-1 rounded-[1px] bg-accent" />
            InsiderFlow
          </Link>

          <nav aria-label={t("primary")} className="ml-3 hidden items-center gap-0.5 sm:flex">
            <Link
              href="/design"
              className="rounded-md px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:bg-fill hover:text-ink"
            >
              {t("design")}
            </Link>
            <Link
              href="/docs"
              className="rounded-md px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:bg-fill hover:text-ink"
            >
              {t("apiDocs")}
            </Link>
          </nav>

          <div className="flex-1" />

          <LocaleSwitcher className="hidden sm:inline-flex" />

          <button
            type="button"
            onClick={openPalette}
            onPointerEnter={() => setPaletteLoaded(true)}
            // The accessible name has to CONTAIN the visible label, or
            // voice-control users cannot say what they can see (WCAG
            // 2.5.3). The visible word is only rendered above `sm`, so the
            // label carries it at every width.
            aria-label={`${t("search")} — ${t("openPalette")}`}
            className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-xs text-ink-muted transition-colors hover:bg-fill hover:text-ink"
          >
            <Search className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{t("search")}</span>
            {/* Decorative for assistive tech: the accessible name already
                says what the button does, and "⌘K" read aloud is noise. */}
            <kbd
              aria-hidden
              className="num rounded-sm border border-border px-1 text-2xs text-ink-faint"
            >
              ⌘K
            </kbd>
          </button>

          <ThemeToggle />

          {session?.authConfigured ? (
            session.userId ? (
              <Link
                href="/settings"
                className="hidden h-8 items-center rounded-md border border-border bg-surface px-3 text-xs text-ink-muted transition-colors hover:bg-fill hover:text-ink sm:inline-flex"
              >
                {t("settings")}
              </Link>
            ) : (
              // The primary affordance in the masthead, and styled like
              // it. On dark the accent is only 3.6:1 as a fill, so this
              // is a bordered accent button with `--accent-bright` type
              // (6.3:1); on light the accent is legible behind white, so
              // it fills. Same weight in both, reached two different ways
              // because the two grounds are not symmetric.
              <Link
                href="/login"
                data-magnetic
                className="inline-flex h-8 items-center rounded-md border border-accent-bright px-3 text-xs font-semibold text-accent-bright transition-colors hover:bg-accent-bright/10 light:border-transparent light:bg-accent light:text-accent-contrast light:hover:bg-accent-bright"
              >
                {t("signIn")}
              </Link>
            )
          ) : null}

          {/* The sidebar disappears below lg, so the full index moves here. */}
          <button
            type="button"
            onClick={openMenu}
            onPointerEnter={() => setMenuLoaded(true)}
            aria-label={t("openMenu")}
            className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-border text-ink-muted transition-colors hover:bg-fill hover:text-ink lg:hidden"
          >
            <Menu className="size-4" aria-hidden />
          </button>
        </div>
      </header>

      {paletteLoaded ? <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} /> : null}
      {menuLoaded ? <NavOverlay open={menuOpen} onOpenChange={setMenuOpen} /> : null}
    </>
  );
}
