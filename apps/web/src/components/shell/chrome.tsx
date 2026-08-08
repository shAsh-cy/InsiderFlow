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
import { Menu, Search, Settings2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { LocaleSwitcher } from "./locale-switcher";
import type { SessionInfo } from "./session-provider";
import { ThemeToggle } from "./theme-toggle";

const CommandPalette = dynamic(() => import("./command-palette"), { ssr: false });
const NavOverlay = dynamic(() => import("./nav-overlay"), { ssr: false });

/**
 * The mark.
 *
 * It used to be a 4px vertical accent rule beside the wordmark — visually
 * identical to the rule the sidebar draws down the left of the CURRENT
 * page, which made the brand read as a permanently-active nav item.
 * People reported it as a stuck highlight, and they were right to.
 *
 * A logo has to be shaped like nothing else in the system. This one is a
 * bordered square holding a tape line: enclosed and horizontally
 * symmetric, where every state marker in the product is an open vertical
 * rule or an underline. It is decorative — the wordmark beside it is the
 * accessible name — and it is never given `aria-current`.
 */
function BrandMark() {
  return (
    <span
      aria-hidden
      className="grid size-5 shrink-0 place-items-center rounded-sm border border-accent-bright/55 text-accent-bright"
    >
      <svg viewBox="0 0 12 12" className="size-3" fill="none" aria-hidden focusable="false">
        <path
          d="M1 8.5 L4 5.5 L6.5 7.5 L11 2.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function ShellChrome({ session }: { session?: SessionInfo }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const settingsActive = pathname === "/settings";
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
          {/* The brand is a link home, never a nav state. It carries no
              `aria-current` under any route, including "/". */}
          <Link
            href="/"
            data-brand
            className="flex items-center gap-2.5 rounded-sm text-sm font-semibold tracking-tight text-ink"
          >
            <BrandMark />
            InsiderFlow
          </Link>

          {/* Design and API docs used to sit here as well as in the sidebar's
              Reference section. One destination reachable from two places in
              the same viewport is not redundancy, it is two things to keep in
              sync — and the top bar is for the controls that apply to every
              page, not for a second copy of the index. */}
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
            <>
              {/* Settings is a destination like any other, so it gets a real
                  active state: `aria-current` plus an accent underline drawn
                  on the header's own bottom rule. An underline, not a left
                  bar — the left bar belongs to the sidebar, and reusing it
                  here is how the brand got mistaken for a nav item. */}
              <Link
                href="/settings"
                aria-current={settingsActive ? "page" : undefined}
                aria-label={t("settings")}
                className={cn(
                  "relative hidden h-8 items-center rounded-md border px-3 text-xs transition-colors sm:inline-flex",
                  settingsActive
                    ? "border-border bg-fill font-medium text-ink after:absolute after:inset-x-2 after:-bottom-3 after:h-0.5 after:rounded-full after:bg-accent-bright after:content-['']"
                    : "border-border bg-surface text-ink-muted hover:bg-fill hover:text-ink",
                )}
              >
                <Settings2 className="size-3.5 sm:hidden" aria-hidden />
                <span className="hidden sm:inline">{t("settings")}</span>
              </Link>

              {session.userId ? (
                // Signed in: who you are, not another copy of "settings".
                // The initial is decorative; the accessible name is the
                // address, because "S" read aloud tells nobody anything.
                <Link
                  href="/settings"
                  aria-label={`${t("account")} — ${session.email ?? ""}`}
                  title={session.email ?? undefined}
                  className="num inline-flex size-8 items-center justify-center rounded-md border border-border bg-surface text-2xs font-semibold text-ink-muted uppercase transition-colors hover:bg-fill hover:text-ink"
                >
                  <span aria-hidden>{(session.email ?? "?").slice(0, 1)}</span>
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
              )}
            </>
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
