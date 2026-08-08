"use client";

/**
 * Full-screen navigation, loaded on demand.
 *
 * Presented as a ledger index rather than a menu: section rules, hairline
 * separators, and a mono folio number against each destination. Radix's
 * Dialog supplies the focus trap, Escape handling and scroll lock — a
 * hand-rolled overlay reliably gets at least one of those wrong.
 *
 * Code-split with the command palette so neither ships on first paint.
 */
import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Dialog, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { Dialog as DialogPrimitive } from "radix-ui";
import { STAGGER_DENSE, springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { activeNavHref, NAV } from "./nav-items";

export default function NavOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
                transition={{ duration: 0.18 }}
                className="fixed inset-0 z-50 bg-bg"
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount>
              <motion.div
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
                transition={springs.layout}
                className="fixed inset-0 z-50 overflow-y-auto outline-none"
              >
                <DialogTitle className="sr-only">{t("menu")}</DialogTitle>

                <div className="mx-auto flex min-h-full max-w-4xl flex-col px-6 py-5">
                  <div className="flex h-9 items-center justify-between">
                    <span className="text-2xs text-ink-faint">{t("menu")}</span>
                    <DialogPrimitive.Close
                      aria-label={t("closeMenu")}
                      className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-border text-ink-muted transition-colors hover:bg-fill hover:text-ink"
                    >
                      <X className="size-4" aria-hidden />
                    </DialogPrimitive.Close>
                  </div>

                  <div className="mt-10 flex flex-col gap-10">
                    {NAV.map((section) => (
                      <nav key={section.section} aria-label={t(`sections.${section.section}`)}>
                        <p className="mb-3 border-b border-border pb-2 text-2xs font-semibold text-ink-faint">
                          {t(`sections.${section.section}`)}
                        </p>
                        <ul>
                          {section.items.map((item) => {
                            const active = item.href === activeHref;
                            folio += 1;
                            const index = folio;
                            return (
                              <motion.li
                                key={item.href}
                                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{
                                  ...springs.reveal,
                                  delay: 0.04 + index * STAGGER_DENSE * 0.4,
                                }}
                              >
                                <Link
                                  href={item.href}
                                  onClick={() => onOpenChange(false)}
                                  aria-current={active ? "page" : undefined}
                                  className={cn(
                                    "group flex items-baseline gap-4 border-b border-border py-3 transition-colors hover:bg-fill",
                                    active ? "text-ink" : "text-ink-muted hover:text-ink",
                                  )}
                                >
                                  <span className="num w-8 shrink-0 text-2xs text-ink-faint">
                                    {String(index).padStart(2, "0")}
                                  </span>
                                  <span className="text-xl font-medium tracking-tight">
                                    {itemLabel(item.key)}
                                  </span>
                                  {active ? (
                                    <span
                                      aria-hidden
                                      className="ml-auto size-1.5 self-center rounded-full bg-accent"
                                    />
                                  ) : null}
                                </Link>
                              </motion.li>
                            );
                          })}
                        </ul>
                      </nav>
                    ))}
                  </div>
                </div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPortal>
        ) : null}
      </AnimatePresence>
    </Dialog>
  );
}
