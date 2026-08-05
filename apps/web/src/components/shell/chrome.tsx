"use client";

/**
 * Top command bar. The ⌘K palette body is code-split: cmdk and the dialog
 * primitives only download once the user opens it, keeping them off the
 * landing page's critical path.
 */
import { Search } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { LocaleSwitcher } from "./locale-switcher";
import type { SessionInfo } from "./session-provider";

const CommandPalette = dynamic(() => import("./command-palette"), { ssr: false });

export function ShellChrome({ session }: { session?: SessionInfo }) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  /** Stays true after first open so the chunk isn't re-requested. */
  const [paletteLoaded, setPaletteLoaded] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteLoaded(true);
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const openPalette = () => {
    setPaletteLoaded(true);
    setOpen(true);
  };

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/6 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <span aria-hidden className="bg-gradient-accent size-2.5 rounded-full shadow-glow" />
            InsiderFlow
          </Link>
          <nav aria-label={t("primary")} className="ml-2 hidden items-center gap-1 sm:flex">
            <Link
              href="/design"
              className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              {t("design")}
            </Link>
            <Link
              href="/docs"
              className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
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
            aria-label={t("openPalette")}
            className="glass inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Search className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{t("search")}</span>
            <kbd className="rounded border border-white/10 bg-white/5 px-1.5 font-mono text-2xs">
              ⌘K
            </kbd>
          </button>
          {session?.authConfigured ? (
            session.userId ? (
              <Link
                href="/settings"
                className="glass inline-flex h-8 items-center rounded-lg px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("settings")}
              </Link>
            ) : (
              <Link
                href="/login"
                className="glass inline-flex h-8 items-center rounded-lg px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("signIn")}
              </Link>
            )
          ) : null}
        </div>
      </header>

      {paletteLoaded ? <CommandPalette open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
