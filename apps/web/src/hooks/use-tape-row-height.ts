"use client";

import { useEffect, useLayoutEffect, useState } from "react";

/**
 * The tape row's height in pixels, read from the CSS that draws it.
 *
 * The window virtualizer has to be told a row height up front — it cannot
 * ask the layout, because the rows it is estimating for do not exist yet.
 * The row is two lines below 640px and one above it, so that number is not
 * a constant any more, and if it lived in both a Tailwind class and a JS
 * literal the two would drift silently: every scroll position past the
 * first screen would be off by the difference, and the further you
 * scrolled the worse it would get.
 *
 * So `--tape-row-h` in globals.css is the single declaration and this
 * reads it. `useLayoutEffect` on the client so the correction lands
 * BEFORE paint — with a plain effect the first frame on a phone would be
 * drawn at the desktop height and then jump, which is a layout shift we
 * would have introduced in the act of removing others.
 */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The server render has no window; 44 matches the >=640px branch. */
const SSR_FALLBACK = 44;

function readRowHeight(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--tape-row-h");
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : SSR_FALLBACK;
}

export function useTapeRowHeight(): number {
  const [height, setHeight] = useState(SSR_FALLBACK);

  useIsomorphicLayoutEffect(() => {
    const apply = () => setHeight(readRowHeight());
    apply();
    // The token changes at exactly one breakpoint, so listen to that rather
    // than to every resize event a drag produces.
    const query = window.matchMedia("(min-width: 640px)");
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  return height;
}
