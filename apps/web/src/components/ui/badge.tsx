import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Ledger badges: 6px radius, hairline, small caps. Rectangular rather
 * than pill-shaped — pills are reserved for interactive filter chips, so
 * the shape alone tells you whether a thing can be clicked.
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap transition-colors [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        // Same theme-asymmetric fill as Button — see the note there.
        default:
          "bg-accent-bright text-accent-contrast [a&]:hover:brightness-115 light:bg-accent light:[a&]:hover:brightness-90",
        secondary: "border-border bg-fill text-ink-muted [a&]:hover:text-ink",
        destructive: "border-accent/40 bg-accent/8 text-accent-ink",
        outline: "border-border text-ink [a&]:hover:bg-fill",
        ghost: "text-ink-muted [a&]:hover:bg-fill [a&]:hover:text-ink",
        link: "text-accent-ink underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
