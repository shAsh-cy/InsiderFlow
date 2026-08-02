"use client";

/**
 * Global client providers. The toaster is code-split (nothing on first
 * paint needs it) and MotionConfig is applied by the components that
 * actually animate, so `motion` stays out of the shared bundle.
 */
import dynamic from "next/dynamic";

import { TooltipProvider } from "@/components/ui/tooltip";

const Toaster = dynamic(() => import("@/components/ui/sonner").then((m) => m.Toaster), {
  ssr: false,
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      {children}
      <Toaster position="bottom-right" theme="dark" />
    </TooltipProvider>
  );
}
