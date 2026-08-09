"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The palette's accelerator, drawn as a key.
 *
 * Presentational only — the binding lives in the masthead's keydown
 * handler, which accepts both modifiers on every platform. This says which
 * one the reader's own keyboard has.
 *
 * The server cannot know the platform, so it renders the majority case and
 * a Mac swaps after hydration. `min-w-12` is what makes that swap free: it
 * is sized for the longer of the two strings, so the button's width — and
 * therefore the position of every control to its right — is the same
 * before and after. Without it this is a two-character layout shift in the
 * masthead on every Mac.
 *
 * `aria-hidden`: the button's accessible name already says what it does,
 * and "⌘K" read aloud is noise.
 */
export function ShortcutHint({ className }: { className?: string }) {
  const [mac, setMac] = useState(false);

  useEffect(() => {
    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
        ?.platform ??
      navigator.platform ??
      navigator.userAgent;
    setMac(/mac|iphone|ipad|ipod/i.test(platform));
  }, []);

  return (
    <kbd
      aria-hidden
      data-testid="palette-hint"
      className={cn(
        "num inline-flex min-w-12 justify-center rounded-sm border border-border px-1 text-2xs text-ink-faint",
        className,
      )}
    >
      {mac ? "⌘K" : "Ctrl K"}
    </kbd>
  );
}
