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
        className="num inline-flex size-5 cursor-pointer items-center justify-center rounded-sm border border-border text-2xs text-ink-faint transition-colors hover:bg-fill hover:text-ink"
      >
        ?
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
