import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Ledger buttons. Hairline borders, 8px radius, no glow and no gradient.
 *
 * `default` is the only filled-oxblood control in the system — the
 * one-accent rule means a view showing two of them is a design bug, not
 * a styling choice. `destructive` is deliberately an outline rather than
 * a second fill: it must read as dangerous without competing with the
 * page's single primary action.
 *
 * Focus is not styled here. The global `:focus-visible` rule in
 * globals.css draws one ring for the entire product, so a control can
 * never quietly opt out of a visible focus state.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-accent [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border border-accent bg-accent text-[#FBFAF7] hover:bg-[#7A2525] hover:border-[#7A2525]",
        destructive:
          "border border-accent/45 bg-surface text-accent-ink hover:bg-accent/8 hover:border-accent",
        outline: "border border-border bg-surface text-ink shadow-card hover:bg-fill",
        secondary: "border border-border bg-fill text-ink hover:bg-border/60",
        ghost: "border border-transparent text-ink-muted hover:bg-fill hover:text-ink",
        link: "text-accent-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-sm px-2 text-2xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-xs has-[>svg]:px-2.5",
        lg: "h-11 px-6 text-base has-[>svg]:px-5",
        icon: "size-9",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
