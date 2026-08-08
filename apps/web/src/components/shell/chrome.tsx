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
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { LocaleSwitcher } from "./locale-switcher";
import type { SessionInfo } from "./session-provider";
import { ShellMenu } from "./shell-menu";
import { ThemeToggle } from "./theme-toggle";

const CommandPalette = dynamic(() => import("./command-palette"), { ssr: false });
const NavDrawer = dynamic(() => import("./nav-drawer"), { ssr: false });

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
  /** Handed to the drawer so Escape returns focus here — see NavDrawer. */
  const menuButtonRef = useRef<HTMLButtonElement>(null);

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
        {/* The rule is full-bleed; the bar's contents ride the same centred
            frame as the page below, so the masthead and the sidebar are one
            object rather than two that happen to be adjacent. The brand is
            then indented by `--shell-nav-inset` — the exact distance from the
            frame edge to a sidebar item's LABEL — so the wordmark and the
            navigation beneath it stand on one line. */}
        <div className="shell-frame flex h-14 items-center gap-1 sm:gap-2 md:gap-3">
          {/* The drawer trigger, on the LEADING edge. The sidebar it stands
              in for is on the left and the drawer slides from the left, so
              the control that opens it belongs on the left; a right-hand
              trigger for a left-hand panel is a small lie about where the
              thing you are opening lives. `-ms-2` lets the 44px hit area
              hang back into the frame padding so the drawn icon still lines
              up with the frame edge. */}
          <button
            ref={menuButtonRef}
            type="button"
            onClick={openMenu}
            onPointerEnter={() => setMenuLoaded(true)}
            aria-label={t("openMenu")}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            data-testid="nav-drawer-trigger"
            className="-ms-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-fill hover:text-ink lg:hidden"
          >
            <Menu className="size-5" aria-hidden />
          </button>

          {/* The brand is a link home, never a nav state. It carries no
              `aria-current` under any route, including "/". */}
          <Link
            href="/"
            data-brand
            style={{ marginInlineStart: "var(--shell-nav-inset)" }}
            // `min-h-11`: with the wordmark `sr-only` below sm the link is only
            // as tall as the 20px mark, and it is a navigation target.
            className="flex min-h-11 min-w-11 shrink-0 items-center gap-2.5 rounded-sm text-sm font-semibold tracking-tight text-ink sm:min-w-0 md:min-h-0"
          >
            <BrandMark />
            {/* `sr-only`, not `hidden`: the wordmark IS this link's
                accessible name, and hiding it below sm would leave a link
                to the home page with no name at all on every phone. */}
            <span className="sr-only sm:not-sr-only">InsiderFlow</span>
          </Link>

          {/* Design and API docs used to sit here as well as in the sidebar's
              Reference section. One destination reachable from two places in
              the same viewport is not redundancy, it is two things to keep in
              sync — and the top bar is for the controls that apply to every
              page, not for a second copy of the index. */}
          <div className="flex-1" />

          <LocaleSwitcher className="hidden md:inline-flex" />

          {/* Below md this is a 44px icon with no drawn box; from md it is
              the bordered control with its word and its accelerator. Same
              button, two densities — a 32px bordered pill is a 32px touch
              target, and there is no width at 360 to make it bigger AND
              keep its label. */}
          <button
            type="button"
            onClick={openPalette}
            onPointerEnter={() => setPaletteLoaded(true)}
            // The accessible name has to CONTAIN the visible label, or
            // voice-control users cannot say what they can see (WCAG
            // 2.5.3). The visible word is only rendered above `md`, so the
            // label carries it at every width.
            aria-label={`${t("search")} — ${t("openPalette")}`}
            data-testid="open-palette"
            className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-fill hover:text-ink md:h-8 md:w-auto md:gap-2 md:border md:border-border md:bg-surface md:px-2.5 md:text-xs"
          >
            <Search className="size-5 md:size-3.5" aria-hidden />
            <span className="hidden md:inline">{t("search")}</span>
            {/* Decorative for assistive tech: the accessible name already
                says what the button does, and "⌘K" read aloud is noise. */}
            <kbd
              aria-hidden
              className="num hidden rounded-sm border border-border px-1 text-2xs text-ink-faint md:inline"
            >
              ⌘K
            </kbd>
          </button>

          <ThemeToggle className="hidden md:inline-flex" />

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
                  "relative hidden h-8 shrink-0 items-center rounded-md border px-3 text-xs transition-colors md:inline-flex",
                  settingsActive
                    ? "border-border bg-fill font-medium text-ink after:absolute after:inset-x-2 after:-bottom-3 after:h-0.5 after:rounded-full after:bg-accent-bright after:content-['']"
                    : "border-border bg-surface text-ink-muted hover:bg-fill hover:text-ink",
                )}
              >
                <Settings2 className="size-3.5 md:hidden" aria-hidden />
                <span className="hidden md:inline">{t("settings")}</span>
              </Link>
            </>
          ) : null}

          {/* Language, theme and Settings fold in here below md. */}
          <ShellMenu
            className="md:hidden"
            showSettings={Boolean(session?.authConfigured)}
            settingsActive={settingsActive}
          />

          {session?.authConfigured ? (
            session.userId ? (
              // Signed in: who you are, not another copy of "settings".
              // The initial is decorative; the accessible name is the
              // address, because "S" read aloud tells nobody anything.
              <Link
                href="/settings"
                aria-label={`${t("account")} — ${session.email ?? ""}`}
                title={session.email ?? undefined}
                className="num inline-flex size-11 shrink-0 items-center justify-center rounded-md text-2xs font-semibold text-ink-muted uppercase transition-colors hover:bg-fill hover:text-ink md:size-8 md:border md:border-border md:bg-surface"
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
              //
              // `h-11` below md: this is the one thing in the bar a reader
              // is most likely to be reaching for, and at 32px it was the
              // smallest target on the screen.
              <Link
                href="/login"
                data-magnetic
                className="inline-flex h-11 shrink-0 items-center rounded-md border border-accent-bright px-3 text-xs font-semibold text-accent-bright transition-colors hover:bg-accent-bright/10 md:h-8 light:border-transparent light:bg-accent light:text-accent-contrast light:hover:bg-accent-bright"
              >
                {t("signIn")}
              </Link>
            )
          ) : null}
        </div>
      </header>

      {paletteLoaded ? <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} /> : null}
      {menuLoaded ? (
        <NavDrawer open={menuOpen} onOpenChange={setMenuOpen} triggerRef={menuButtonRef} />
      ) : null}
    </>
  );
}
