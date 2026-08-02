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
        className="text-2xs inline-flex items-center gap-1 uppercase tracking-widest text-subtle-foreground transition-colors hover:text-foreground"
      >
        Code legend
        <ChevronDown
          className={cn("size-3 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <dl className="glass mt-2 grid gap-x-6 gap-y-1.5 rounded-xl p-4 sm:grid-cols-2">
          {Object.entries(SEC_TRANSACTION_CODES).map(([code, description]) => (
            <div key={code} className="flex items-baseline gap-2.5 text-xs">
              <dt className="shrink-0">
                <TransactionCodeBadge code={code} />
              </dt>
              <dd className="truncate text-muted-foreground" title={description}>
                {description}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
