import { formatDualCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

import { NotDisclosed } from "./not-disclosed";

/**
 * Dual-currency money: native notation first, USD equivalent second —
 * "₹24.5 Cr · $2.79M". USD-native trades collapse to one figure. Null
 * renders the NotDisclosed treatment (SAST rows carry value=NULL by design).
 */
export function CurrencyValue({
  value,
  currency,
  valueUsd,
  className,
}: {
  value: number | null;
  currency: string;
  valueUsd: number | null;
  className?: string;
}) {
  const formatted = formatDualCurrency(value, currency, valueUsd);
  if (formatted === null) return <NotDisclosed className={className} />;
  return <span className={cn("tnum whitespace-nowrap", className)}>{formatted}</span>;
}
