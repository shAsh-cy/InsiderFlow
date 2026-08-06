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

import { TooltipProvider } from "@/components/ui/tooltip";

const Toaster = dynamic(() => import("@/components/ui/sonner").then((m) => m.Toaster), {
  ssr: false,
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="insiderflow-theme"
      disableTransitionOnChange
    >
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={150}>
          {children}
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
