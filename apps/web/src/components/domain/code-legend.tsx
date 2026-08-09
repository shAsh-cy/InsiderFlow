"use client";

import { SEC_TRANSACTION_CODES } from "@insiderflow/core";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { TransactionCodeBadge } from "./transaction-code-badge";

/** Collapsible legend for all 20 transaction codes, sourced from core. */
export function CodeLegend({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        // The same shape as every other control on the filter row. It was a
        // bare faint text link with a chevron, which reads as a footnote
        // rather than as something you press — and what it opens is the key
        // to twenty badges the reader is looking at right now.
        className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-2xs text-ink-muted transition-colors hover:bg-fill hover:text-ink md:h-8 md:px-3"
      >
        Code legend
        <ChevronDown
          className={cn("size-3 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <dl className="surface mt-2 grid gap-x-6 gap-y-2 rounded-lg p-4 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(SEC_TRANSACTION_CODES).map(([code, description]) => (
            <div key={code} className="flex items-baseline gap-2.5 text-xs">
              <dt className="shrink-0">
                <TransactionCodeBadge code={code} />
              </dt>
              <dd className="truncate text-ink-muted" title={description}>
                {description}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
