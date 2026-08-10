/**
 * "Start this once the page is done arriving."
 *
 * Extracted from the hook that uses it so the wiring can be tested against
 * a fake host rather than a browser — the same shape as
 * `TradeStreamCore`, and for the same reason: the interesting part is
 * WHICH trigger wins and whether the other one is cleaned up, and none of
 * that needs React or a DOM to check.
 */

/** Anything that means a reader has arrived and started using the page. */
export const INTERACTION_EVENTS = [
  "pointerdown",
  "keydown",
  "touchstart",
  "wheel",
  "scroll",
] as const;

export interface ActivationHost {
  addEventListener(
    type: string,
    listener: () => void,
    options?: { passive?: boolean; once?: boolean },
  ): void;
  removeEventListener(type: string, listener: () => void): void;
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

/**
 * Calls `onReady` exactly once — on the browser's first idle moment, or on
 * the reader's first interaction, whichever happens first — and returns a
 * teardown that cancels whatever did not win.
 *
 * Two triggers, not one. `requestIdleCallback` with a timeout is a
 * deferral and never an abandonment: a page that never goes idle still
 * starts by the deadline. But a phone still busy at the deadline is
 * exactly the phone where the deadline fires into a contended main
 * thread, and a reader who has already scrolled or tapped is a reader who
 * is here.
 *
 * Hosts without `requestIdleCallback` (Safari, at time of writing) fall
 * through to a short timer, which is the same promise with a worse
 * guarantee.
 */
export function activateWhenReady(
  host: ActivationHost,
  timeoutMs: number,
  onReady: () => void,
): () => void {
  let settled = false;
  let idleHandle: number | undefined;
  let timerHandle: number | undefined;

  const cancel = () => {
    for (const event of INTERACTION_EVENTS) host.removeEventListener(event, fire);
    if (idleHandle !== undefined) host.cancelIdleCallback?.(idleHandle);
    if (timerHandle !== undefined) host.clearTimeout(timerHandle);
  };

  function fire() {
    if (settled) return;
    settled = true;
    // Cancelled BEFORE the callback runs: `onReady` typically opens a
    // connection and re-renders, and a stray idle callback firing into
    // that afterwards is a second activation of something already started.
    cancel();
    onReady();
  }

  for (const event of INTERACTION_EVENTS) {
    host.addEventListener(event, fire, { passive: true, once: true });
  }

  if (typeof host.requestIdleCallback === "function") {
    idleHandle = host.requestIdleCallback(fire, { timeout: timeoutMs });
  } else {
    timerHandle = host.setTimeout(fire, Math.min(timeoutMs, 200));
  }

  return cancel;
}
