"use client";

import { ChevronDown } from "lucide-react";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

/**
 * The signed-in reader, drawn.
 *
 * Purely presentational and deliberately free of any overlay primitive:
 * this is what the masthead renders before anything has been clicked, and
 * it is what the account menu uses as its trigger once the menu's chunk
 * has arrived. Two mounts, one markup — so the swap from static chip to
 * menu trigger moves nothing.
 *
 * A drawn avatar, not a floating letter. The initial used to sit on the
 * bar with no boundary of its own, so a signed-in reader saw a stray
 * character where every other control had a shape. The disc is `--fill`
 * with a hairline so it reads as an object at 20px, and the chevron says
 * the chip opens something.
 */
export const AccountChip = forwardRef<
  HTMLButtonElement,
  {
    email: string | null;
    label: string;
    className?: string;
  } & React.ComponentPropsWithoutRef<"button">
>(function AccountChip({ email, label, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      // The address is the accessible name: "S" read aloud tells nobody
      // anything.
      aria-label={`${label} — ${email ?? ""}`}
      title={email ?? undefined}
      data-testid="account-chip"
      className={cn(
        "group inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-transparent pe-1 ps-1 text-ink-muted transition-colors hover:border-border hover:bg-fill hover:text-ink md:h-8 md:pe-2",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="num grid size-8 shrink-0 place-items-center rounded-full border border-border bg-fill text-2xs font-semibold uppercase md:size-6"
      >
        {(email ?? "?").slice(0, 1)}
      </span>
      <ChevronDown aria-hidden className="size-3 shrink-0 opacity-70" />
    </button>
  );
});
