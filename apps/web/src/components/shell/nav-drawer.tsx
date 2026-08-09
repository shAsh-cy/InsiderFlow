"use client";

/**
 * The navigation, off-canvas, below lg.
 *
 * r3 put the whole index in a full-screen sheet. That reads as a
 * destination in its own right — it replaces the page, and coming back
 * feels like navigating rather than dismissing. A drawer is the honest
 * shape for this: it is the SIDEBAR, which is exactly what it contains,
 * moved off-canvas because there is no room for it. So it slides from the
 * left, where the sidebar lives, behind a trigger on the left, and the
 * page stays visible behind the scrim so it is obvious you never left it.
 *
 * Radix's Dialog supplies the focus trap, Escape, scroll lock and
 * dismiss-on-outside-press. One thing it does NOT supply here: focus
 * restoration. `DialogContent` hard-wires an `onCloseAutoFocus` that
 * cancels FocusScope's own restore and focuses `context.triggerRef`
 * instead — and `triggerRef` is only ever populated by `DialogTrigger`.
 * This dialog is opened by a plain button in the masthead, so that ref is
 * null, the default handler preventDefaults the restore and focuses
 * nothing, and focus falls back to <body>: a keyboard user who opens the
 * menu and presses Escape is returned to the top of the document. Passing
 * an explicit handler wins, because `composeEventHandlers` runs the
 * caller's first and skips the default once it has preventDefaulted.
 *
 * It also carries the language switcher and the theme toggle, which below
 * 640px have nowhere else to be — see the masthead for why that mattered.
 *
 * Code-split with the command palette so neither ships on first paint.
 */
import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { RefObject } from "react";

import { Dialog, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { Dialog as DialogPrimitive } from "radix-ui";
import { STAGGER_DENSE, springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { BrandLink } from "./brand";
import { activeNavHref, NAV } from "./nav-items";

export default function NavDrawer({
  open,
  onOpenChange,
  triggerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The masthead button that opened this. Focus goes back to it on close. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const activeHref = activeNavHref(pathname);
  const reduced = useReducedMotion();
  const itemLabel = (key: string) => (key === "apiDocs" ? t("apiDocs") : t(`items.${key}`));

  // One running folio number across all sections, like an index.
  let folio = 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogPortal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="fixed inset-0 z-50 bg-[var(--scrim)]"
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content
              asChild
              forceMount
              data-testid="nav-drawer"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                triggerRef?.current?.focus();
              }}
            >
              <motion.div
                // Reduced motion gets the fade and not the slide. A panel
                // travelling 300px across the screen is exactly the kind of
                // large-area translation the preference is asking about.
                initial={reduced ? { opacity: 0 } : { opacity: 0, x: "-100%" }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, x: "-100%" }}
                transition={reduced ? { duration: 0.14 } : springs.layout}
                className="fixed inset-y-0 left-0 z-50 flex w-[19rem] max-w-[86vw] flex-col overflow-y-auto border-r border-border bg-bg outline-none"
              >
                <DialogTitle className="sr-only">{t("menu")}</DialogTitle>

                {/* The brand, not the word "Menu". The drawer IS the
                    sidebar, and since r6 the sidebar is where identity
                    lives; a panel that slides over the whole left of a
                    phone screen and does not say what product it belongs
                    to is the same lost-identity problem the masthead had.
                    `ps-5` puts the mark on the same x as the nav items
                    below it (8px list padding + 2px state rule + 10px). */}
                <div className="flex h-14 shrink-0 items-center justify-between border-b border-border pe-4 ps-5">
                  <BrandLink />
                  <DialogPrimitive.Close
                    aria-label={t("closeMenu")}
                    className="-mr-2 inline-flex size-11 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-fill hover:text-ink"
                  >
                    <X className="size-4" aria-hidden />
                  </DialogPrimitive.Close>
                </div>

                <div className="flex flex-1 flex-col gap-6 px-2 py-4">
                  {NAV.map((section) => (
                    <nav key={section.section} aria-label={t(`sections.${section.section}`)}>
                      <p className="mb-1 px-3 text-2xs font-semibold text-ink-faint">
                        {t(`sections.${section.section}`)}
                      </p>
                      <ul>
                        {section.items.map((item) => {
                          const active = item.href === activeHref;
                          const Icon = item.icon;
                          folio += 1;
                          const index = folio;
                          if (item.soon) {
                            return (
                              <li key={item.href}>
                                <span
                                  aria-disabled
                                  className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-ink-faint"
                                >
                                  <Icon className="size-4 shrink-0" aria-hidden />
                                  {itemLabel(item.key)}
                                  <span className="ml-auto rounded-sm border border-border px-1 text-2xs">
                                    soon
                                  </span>
                                </span>
                              </li>
                            );
                          }
                          return (
                            <motion.li
                              key={item.href}
                              initial={reduced ? { opacity: 0 } : { opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{
                                ...springs.reveal,
                                delay: 0.02 + index * STAGGER_DENSE * 0.3,
                              }}
                            >
                              <Link
                                href={item.href}
                                onClick={() => onOpenChange(false)}
                                aria-current={active ? "page" : undefined}
                                // The sidebar's own three signals, kept
                                // identical so the drawer is recognisably the
                                // same object: accent rule, tinted ground,
                                // heavier ink. 44px minimum row, because this
                                // is the touch surface the sidebar never was.
                                className={cn(
                                  "flex min-h-11 items-center gap-3 border-l-2 py-2 pr-3 pl-2.5 text-sm transition-colors",
                                  active
                                    ? "border-l-accent-bright bg-fill font-medium text-ink"
                                    : "border-l-transparent text-ink-muted hover:bg-fill/60 hover:text-ink",
                                )}
                              >
                                <Icon className="size-4 shrink-0" aria-hidden />
                                <span className="min-w-0 flex-1">{itemLabel(item.key)}</span>
                                <span className="num text-2xs text-ink-faint">
                                  {String(index).padStart(2, "0")}
                                </span>
                              </Link>
                            </motion.li>
                          );
                        })}
                      </ul>
                    </nav>
                  ))}
                </div>

                {/* The language and theme controls are deliberately NOT here.
                    They live in the masthead's overflow menu, which is the
                    one home for controls that apply to every page — the same
                    reasoning that removed Design and API docs from the top
                    bar in r3. This drawer is the index, and only the index. */}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPortal>
        ) : null}
      </AnimatePresence>
    </Dialog>
  );
}
