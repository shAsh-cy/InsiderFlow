"use client";

import { useEffect, useState } from "react";

/**
 * False until the browser has a spare moment, then true forever.
 *
 * For work that must happen but must not happen DURING hydration. The
 * landing page's tape is the case this exists for: its rows are already in
 * the server-rendered HTML, so opening the event stream is not what puts
 * them on screen — it is what keeps them current — and doing it inside the
 * hydration window spends main-thread time on a connection nobody is
 * waiting for yet.
 *
 * `requestIdleCallback` with a timeout, so it is a deferral and never an
 * abandonment: a page that never goes idle still starts the work by the
 * deadline. Browsers without it (Safari, at time of writing) fall through
 * to a timer, which is the same promise with a worse guarantee.
 */
export function useIdle(timeoutMs = 1500): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    const request = window.requestIdleCallback;
    if (typeof request === "function") {
      const handle = request(() => setIdle(true), { timeout: timeoutMs });
      return () => window.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(() => setIdle(true), Math.min(timeoutMs, 200));
    return () => window.clearTimeout(timer);
  }, [timeoutMs]);

  return idle;
}
