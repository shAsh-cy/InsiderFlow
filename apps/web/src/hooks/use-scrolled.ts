"use client";

import { useEffect, useRef, useState } from "react";

/**
 * True once the page has moved off the top.
 *
 * Measured with an IntersectionObserver on a 1px sentinel at the document's
 * origin, not with a scroll listener. The masthead is `position: fixed`
 * over a route that can be a 10,000-row virtualized table, and a listener
 * that runs per scroll frame to read `scrollY` is main-thread work spent on
 * a boolean that changes twice in a session. The observer fires exactly on
 * the two transitions and costs nothing in between.
 *
 * The sentinel has to be rendered in normal flow at the top of the page —
 * see the masthead, which renders it as a sibling of the fixed bar.
 */
export function useScrolled(): {
  scrolled: boolean;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
} {
  const [scrolled, setScrolled] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry!.isIntersecting),
      // No threshold and no root: the sentinel leaves the viewport the
      // moment the document moves, which is precisely the state being
      // reported.
      { threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { scrolled, sentinelRef };
}
