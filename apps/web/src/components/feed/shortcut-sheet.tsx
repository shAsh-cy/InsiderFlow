"use client";

/**
 * What the keyboard does, written down.
 *
 * An undocumented shortcut is a shortcut for the person who wrote it. The
 * "?" convention is only discoverable if you already know it, so this is
 * also a visible button sitting next to the tape's own heading — the key
 * is the accelerator, the button is the door.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SHORTCUTS: Array<[string, string]> = [
  ["↑ ↓", "rowMove"],
  ["Home / End", "rowEnds"],
  ["Enter", "rowOpen"],
  ["w", "rowWatchKey"],
  ["⌘K / Ctrl K", "palette"],
  ["?", "thisSheet"],
];

export function ShortcutSheet() {
  const t = useTranslations("shortcuts");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "?") return;
      const target = event.target as HTMLElement | null;
      // "?" is a character someone may well be typing.
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("open")}
        title={t("open")}
        data-testid="shortcut-sheet-open"
        // 44px of hit area below md around a 20px drawn box: the border stays
        // on the inner span so the control does not become the heaviest
        // object on a phone tape header.
        className="inline-flex size-11 cursor-pointer items-center justify-center text-ink-faint transition-colors hover:text-ink md:size-5 md:rounded-sm md:border md:border-border md:hover:bg-fill"
      >
        {/* A glyph, not a word: `aria-hidden` so the button reads as an
            icon control named by its label. Left visible it would be a
            control whose visible text ("?") is absent from its accessible
            name ("Keyboard shortcuts") — WCAG 2.5.3 — and a voice-control
            user would have nothing sayable to activate it with. */}
        <span
          aria-hidden
          className="num grid size-5 place-items-center rounded-sm border border-border text-2xs md:size-full md:border-0"
        >
          ?
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm" data-testid="shortcut-sheet">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("body")}</DialogDescription>
          </DialogHeader>
          <dl className="flex flex-col divide-y divide-border">
            {SHORTCUTS.map(([keys, key]) => (
              <div key={key} className="flex items-baseline gap-4 py-2 first:pt-0 last:pb-0">
                <dt className="num w-28 shrink-0 text-2xs text-ink-faint">{keys}</dt>
                <dd className="text-sm text-ink-muted">{t(key)}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
