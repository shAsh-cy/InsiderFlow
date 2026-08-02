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
 * Colors come from the shared signal-weight map in @insiderflow/core —
 * the frontend never redefines transaction codes. Positive weight = buy
 * pressure (teal), negative = sell pressure (rose), zero = neutral;
 * saturation scales with |weight|.
 */
function toneFor(weight: number): string {
  if (weight >= 0.5) return "bg-buy-soft text-buy ring-buy/40";
  if (weight > 0) return "bg-buy-soft/60 text-buy/90 ring-buy/20";
  if (weight <= -0.5) return "bg-sell-soft text-sell ring-sell/40";
  if (weight < 0) return "bg-sell-soft/60 text-sell/90 ring-sell/20";
  return "bg-flat-soft text-flat ring-white/10";
}

export function TransactionCodeBadge({ code, className }: { code: string; className?: string }) {
  const normalized = code.trim().toUpperCase();
  const known = isSecTransactionCode(normalized);
  const weight = signalWeight(normalized);
  const description = known ? SEC_TRANSACTION_CODES[normalized] : "Unknown transaction code";

  const badge = (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-xs font-bold ring-1 ring-inset",
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
        <p className="font-mono text-2xs text-muted-foreground">
          {normalized} · signal weight {known ? TRANSACTION_SIGNAL_WEIGHTS[normalized] : 0}
        </p>
        <p>{description}</p>
      </TooltipContent>
    </Tooltip>
  );
}
