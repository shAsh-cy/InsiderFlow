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

export function Providers({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    /*
     * Dark is the default, and it is not the OS's decision.
     *
     * Terminal is a dark-first identity: the whole token layer is written
     * with `:root` AS the dark theme and `.light` as the override, the
     * accent is tuned twice because one green cannot be both a fill and a
     * label on two grounds, and the product is a trading tape. Deferring
     * that to `prefers-color-scheme` meant roughly half of all first
     * visitors met a light theme the design does not lead with — and it
     * made the identity a property of the visitor's machine rather than of
     * the product.
     *
     * `enableSystem={false}` also removes the pre-hydration script's need
     * to consult a media query at all, so the class it writes is decided
     * by one branch: stored preference, else dark. Light stays one click
     * away on the existing toggle, and a stored choice is still honoured —
     * a visitor who chose light keeps light, and nothing here clears what
     * they chose.
     *
     * `value` forces next-themes to write `.light` as well as `.dark`,
     * because with a dark-first `:root` the light theme has to be an
     * explicit opt-in class rather than the absence of one.
     */
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      value={{ light: "light", dark: "dark" }}
      storageKey="insiderflow-theme"
      disableTransitionOnChange
      /*
       * The ONE script Next does not nonce for us.
       *
       * next-themes writes its own inline anti-flash script — the thing
       * that sets the class on <html> before paint — and it is not a
       * script Next emitted, so the framework's automatic nonce stamping
       * does not reach it. Measured under report-only: 39 of 40 script
       * tags on `/` carried the nonce and this was the fortieth.
       *
       * Under an enforced policy it is refused, and the failure is
       * specifically the one this script exists to prevent: the page
       * paints in the default theme and then snaps to the stored one
       * after hydration. A visitor who chose light gets a dark flash on
       * every navigation. Passing the nonce is the whole fix.
       */
      nonce={nonce}
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
