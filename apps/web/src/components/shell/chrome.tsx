"use client";

/**
 * The masthead.
 *
 * Both heavy overlays — the ⌘K palette and the full-screen nav — are
 * code-split: cmdk, the dialog primitives and the motion runtime only
 * download once someone actually reaches for them, keeping all of it off
 * the landing page's critical path.
 *
 * r6 moved the brand out of here on app shells. The bar used to pin its
 * contents to the viewport's left edge while the page beneath started at
 * the content gutter, which put the logo and the page's own H1 on two
 * different left edges — the misalignment people reported. The sidebar
 * owns product identity now, and this is an action bar that shares the
 * content's margins: see the r6 amendment at the top of globals.css.
 */
import { Menu, Search, Settings2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { useScrolled } from "@/hooks/use-scrolled";
import { accountState } from "@/lib/auth/account-state";
import { cn } from "@/lib/utils";

import { BrandLink } from "./brand";
import { Breadcrumbs } from "./breadcrumb";
import { LocaleSwitcher } from "./locale-switcher";
import type { SessionInfo } from "./session-provider";
import { ShortcutHint } from "./shortcut-hint";
import { ThemeToggle } from "./theme-toggle";

const CommandPalette = dynamic(() => import("./command-palette"), { ssr: false });
const NavDrawer = dynamic(() => import("./nav-drawer"), { ssr: false });
/**
 * NOT code-split, and the attempt is worth recording so it is not made
 * again. Deferring an overlay whose TRIGGER lives inside it means swapping
 * the trigger element on first press — and a browser only dispatches
 * `click` when pointerdown and pointerup share a target, so the press that
 * loads the menu is the press the menu never receives. Radix then mounts
 * open with focus on `<body>` and dismisses itself. It cost a first tap on
 * the one control that reaches language and theme on a phone, which is the
 * exact fault r3 was rebuilt to fix.
 *
 * It also bought nothing: the tape's row menu already puts this primitive
 * in the landing's graph, so both of these ride a chunk that is downloaded
 * either way. The 187 kB that mattered was the auth SDK, and that is
 * deferred inside `lib/auth/supabase-browser` where there is no trigger to
 * lose.
 */
import AccountMenu from "./account-menu";
import { ShellMenu } from "./shell-menu";

export function ShellChrome({ session }: { session?: SessionInfo }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const settingsActive = pathname === "/settings";
  // Server-resolved: the bar never asks the browser who is signed in.
  const account = accountState(session);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Stays true after first open so the chunk isn't re-requested. */
  const [paletteLoaded, setPaletteLoaded] = useState(false);
  const [menuLoaded, setMenuLoaded] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  /** Handed to the drawer so Escape returns focus here — see NavDrawer. */
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const { scrolled, sentinelRef } = useScrolled();

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
      {/* The scroll sentinel: 1px of nothing at the document's origin. The
          bar's border and blur key off whether this is still on screen, so
          nothing has to run a listener per scroll frame over a 10,000-row
          table to know whether the page has moved. */}
      <div
        ref={sentinelRef}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
      />

      {/* The bar always has a ground and always has an edge — r7. Both are
          tokens (`--masthead-bar-bg`, `--masthead-hairline`) applied in
          globals.css, which is why there is no `bg-*` or `border-*` utility
          here: r6 drew neither until something scrolled under the bar, and
          the result was a brand sitting on the page with nothing containing
          it. Scroll is additive from there — more opacity and a blur — and
          the transition is off under prefers-reduced-motion. */}
      <header
        data-masthead
        data-scrolled={scrolled ? "true" : "false"}
        className="fixed inset-x-0 top-0 z-50 border-b"
      >
        {/* `.masthead-shell` is the whole of the r6 alignment fix: on the
            landing it resolves to the landing's own margin token, so the
            logo and the hero H1 share one x by construction; on an app
            shell it resolves to the content well's gutter, and the bar's
            box has already been moved to start at the sidebar's right
            edge. Either way the bar measures itself against the content
            beneath it rather than against the bezel. */}
        <div className="masthead-shell flex h-14 items-center gap-1 sm:gap-2 md:gap-3">
          {/* The drawer trigger, on the LEADING edge. The sidebar it stands
              in for is on the left and the drawer slides from the left, so
              the control that opens it belongs on the left; a right-hand
              trigger for a left-hand panel is a small lie about where the
              thing you are opening lives. `-ms-3` lets the 44px hit area
              hang back by exactly the icon's own centring inset (44 − 20)/2,
              so the DRAWN icon — not the button's box — starts on the
              content's left edge. */}
          <button
            ref={menuButtonRef}
            type="button"
            onClick={openMenu}
            onPointerEnter={() => setMenuLoaded(true)}
            aria-label={t("openMenu")}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            data-testid="nav-drawer-trigger"
            className="-ms-3 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-fill hover:text-ink lg:hidden"
          >
            <Menu className="size-5" aria-hidden />
          </button>

          {/* The brand, on the shells that have nowhere better to put it.
              On an app shell above 1024 this is `display:none` and the
              sidebar's header carries it instead — see globals.css. Below
              1024 the sidebar is off-canvas, so it stays here: identity
              must not disappear the moment the drawer closes.

              `min-h-11`: with the wordmark `sr-only` below sm the link is
              only as tall as the 20px mark, and it is a navigation target. */}
          <BrandLink wordmark="responsive" className="min-h-11 min-w-11 sm:min-w-0 md:min-h-0" />

          {/* The trail, on the two routes deep enough to need one. It sits
              BEFORE the spacer on purpose: appearing after hydration then
              moves nothing to its right, so a crumb costs no layout shift.
              On an app shell above 1024 this is the only thing in the left
              half of the bar, which is the space the brand vacated. */}
          <Breadcrumbs />

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
            {/* ⌘K on a Mac, Ctrl K everywhere else — it used to promise a
                Command key to the ~85% of readers who do not have one. */}
            <ShortcutHint className="hidden md:inline-flex" />
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

          {/* Language, theme and Settings fold in here below md. Code-split
              on the same rule as everything else in this bar: it is an
              overlay, it only exists below `md`, and it opens on a press —
              so its primitive is fetched on hover or on that press, not on
              every first paint of every route. */}
          <ShellMenu
            className="md:hidden"
            showSettings={Boolean(session?.authConfigured)}
            settingsActive={settingsActive}
          />

          {account === "account" ? (
            // Signed in: who you are, not another copy of "settings". The
            // chip is rendered from the SERVER-resolved session and carries
            // no client auth code; its menu — and the overlay primitive
            // behind it — arrives on the first hover, focus or press.
            <AccountMenu
              email={session?.email ?? null}
              open={accountOpen}
              onOpenChange={setAccountOpen}
            />
          ) : account === "sign-in" ? (
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
