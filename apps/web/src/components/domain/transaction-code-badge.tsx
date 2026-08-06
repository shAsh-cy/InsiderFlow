"use client";

import {
  SEC_TRANSACTION_CODES,
  TRANSACTION_SIGNAL_WEIGHTS,
  isSecTransactionCode,
  signalWeight,
} from "@insiderflow/core";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Colours come from the shared signal-weight map in @insiderflow/core —
 * the frontend never redefines transaction codes.
 *
 * Positive weight = buy pressure (Wong vermillion), negative = sell
 * pressure (Wong blue), zero = neutral ink. Never red–green. Fill density
 * tracks |weight|, so strength survives greyscale, and the code letter
 * itself (P, S, A, …) is a second, non-colour channel for direction.
 */
function toneFor(weight: number): string {
  if (weight >= 0.5) return "border-buy/45 bg-buy-soft text-buy-ink";
  if (weight > 0) return "border-buy/25 text-buy-ink";
  if (weight <= -0.5) return "border-sell/45 bg-sell-soft text-sell-ink";
  if (weight < 0) return "border-sell/25 text-sell-ink";
  return "border-border bg-fill text-ink-muted";
}

export function TransactionCodeBadge({ code, className }: { code: string; className?: string }) {
  const normalized = code.trim().toUpperCase();
  const known = isSecTransactionCode(normalized);
  const weight = signalWeight(normalized);
  const description = known ? SEC_TRANSACTION_CODES[normalized] : "Unknown transaction code";

  const badge = (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border px-1 font-mono text-2xs font-semibold tabular-nums",
        toneFor(weight),
        className,
      )}
    >
      {normalized}
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Code ${normalized}: ${description}`}
          className="cursor-help align-middle"
        >
          {badge}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72">
        <p className="font-mono text-2xs opacity-70">
          {normalized} · signal weight {known ? TRANSACTION_SIGNAL_WEIGHTS[normalized] : 0}
        </p>
        <p>{description}</p>
      </TooltipContent>
    </Tooltip>
  );
}
