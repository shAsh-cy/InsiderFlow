"use client";

import { useEffect, useState } from "react";

import { activateWhenReady } from "@/lib/activation";

/**
 * False until the browser has a spare moment OR the reader touches the
 * page, whichever comes first. True forever after.
 *
 * For work that must happen but must not happen DURING hydration. The
 * landing page's tape is the case this exists for: its rows are already in
 * the server-rendered HTML, so opening the event stream is not what puts
 * them on screen — it is what keeps them current — and doing it inside the
 * hydration window spends main-thread time on a connection nobody is
 * waiting for yet.
 *
 * The trigger wiring lives in `lib/activation`, where it can be tested
 * against a fake host instead of a browser.
 */
export function useIdle(timeoutMs = 1500): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) return;
    return activateWhenReady(window, timeoutMs, () => setReady(true));
  }, [ready, timeoutMs]);

  return ready;
}
