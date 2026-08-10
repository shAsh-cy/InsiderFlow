"use client";

/**
 * Magnetic hover for the one or two primary CTAs on a page.
 *
 * Opt-in by attribute (`data-magnetic`) so nothing has to be re-wrapped,
 * and so a control can carry the behaviour without its component knowing
 * about motion at all.
 *
 * Four hard gates, all of which must pass:
 *
 *  1. `(hover: hover) and (pointer: fine)` — on a touch screen there is no
 *     hover, and the effect would either never fire or fire once and stick.
 *  2. `useReducedMotion()` — a control that chases the cursor is exactly
 *     the kind of unrequested movement the setting exists to stop.
 *  3. Transform only. No layout, no paint — the compositor can run this
 *     without the main thread, which is what keeps it off the frame
 *     budget of whatever else is on the page.
 *  4. One rAF-batched listener on the document, and geometry measured on
 *     ENTER rather than per move. `getBoundingClientRect()` inside a
 *     mousemove handler forces a synchronous layout on every event —
 *     the classic way a "smooth" effect becomes the jankiest thing on the
 *     page.
 */
import { useReducedMotion } from "motion/react";
import { useEffect } from "react";

/** How far the control may travel, as a fraction of cursor offset. */
const STRENGTH = 0.14;
/** Beyond this many px from the centre, the pull is released. */
const RADIUS = 84;

export function MagneticField() {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!fine.matches) return;

    let frame = 0;
    let active: HTMLElement | null = null;
    let box: DOMRect | null = null;
    let pointerX = 0;
    let pointerY = 0;

    const release = () => {
      if (active) {
        active.style.transform = "";
        active.style.transition = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
      }
      active = null;
      box = null;
    };

    const apply = () => {
      frame = 0;
      if (!active || !box) return;
      const dx = pointerX - (box.left + box.width / 2);
      const dy = pointerY - (box.top + box.height / 2);
      if (Math.hypot(dx, dy) > RADIUS + Math.max(box.width, box.height) / 2) {
        release();
        return;
      }
      active.style.transition = "";
      active.style.transform = `translate3d(${dx * STRENGTH}px, ${dy * STRENGTH}px, 0)`;
    };

    const onPointerMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;

      if (!active) {
        const target = (event.target as HTMLElement | null)?.closest?.<HTMLElement>(
          "[data-magnetic]",
        );
        if (!target) return;
        active = target;
        // Measured once, on entry — not per event.
        box = target.getBoundingClientRect();
      }
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    // Scrolling moves the element out from under a stale rect, so the
    // cached geometry has to be dropped rather than trusted.
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("scroll", release, { passive: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", release);
      release();
    };
  }, [reduced]);

  return null;
}
