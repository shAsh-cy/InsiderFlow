"use client";

/**
 * Global client providers.
 *
 * MotionConfig sits here rather than at each animated component so the
 * `reducedMotion="user"` contract is impossible to forget: any spring
 * anywhere in the tree honours the OS setting by default. Components
 * that move something large still branch on useReducedMotion() to drop
 * the transform entirely rather than merely shortening it.
 *
 * The toaster is code-split — nothing on first paint needs it.
 */
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import dynamic from "next/dynamic";

import { MagneticField } from "@/components/motion/magnetic";
import { TooltipProvider } from "@/components/ui/tooltip";

const Toaster = dynamic(() => import("@/components/ui/sonner").then((m) => m.Toaster), {
  ssr: false,
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // `value` forces next-themes to write `.light` as well as `.dark`.
    // The token layer is dark-first (`:root` IS dark), so light has to be
    // an explicit opt-in class rather than the absence of one — otherwise
    // a light-preferring visitor gets the dark tokens with no override.
    // defaultTheme stays "system" so we respect the OS on first load; the
    // dark-first `:root` only decides what unstyled/no-JS HTML looks like.
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      value={{ light: "light", dark: "dark" }}
      storageKey="insiderflow-theme"
      disableTransitionOnChange
    >
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={150}>
          {children}
          {/* Renders nothing; attaches one gated pointer listener that
              gives `[data-magnetic]` controls a slight pull. */}
          <MagneticField />
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
