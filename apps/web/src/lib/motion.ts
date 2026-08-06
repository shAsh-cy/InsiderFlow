/**
 * Ledger motion presets.
 *
 * Every animated surface in the product pulls its transition from here —
 * a component that hand-rolls a spring is a bug, because the whole point
 * of the system is that a row inserting, a card lifting, and a number
 * ticking all feel like the same hand.
 *
 * Springs, not durations: physical settling reads as material behaviour,
 * and it stays coherent when two animations of different distances run
 * side by side (a duration cannot do that).
 */

export const springs = {
  /** Hover lift. Slightly underdamped — a small, deliberate overshoot. */
  snappy: { type: "spring", stiffness: 400, damping: 17, mass: 1 },
  /** Press / release. Critically damped: never bounce under a finger. */
  press: { type: "spring", stiffness: 400, damping: 30 },
  /** The `layout` prop — reflow, reorder, size change. */
  layout: { type: "spring", stiffness: 500, damping: 30 },
  /** Live SSE row insertion. Firm enough to feel like a tape striking. */
  feedRow: { type: "spring", stiffness: 350, damping: 30, mass: 1 },
  /** Scroll-triggered section reveal. Slow, editorial. */
  reveal: { type: "spring", stiffness: 100, damping: 20, mass: 1 },
  /** Number count-up. Long settle so the final digits are readable. */
  counter: { mass: 0.8, stiffness: 75, damping: 15 },
} as const;

/** Default stagger between siblings in a revealed group. */
export const STAGGER = 0.1;

/** Denser grids (stat rows, badge fields) stagger at half the interval. */
export const STAGGER_DENSE = 0.05;

/**
 * Standard reveal pair. Transform is the part that must be branched
 * behind `useReducedMotion()` — opacity is always safe to animate.
 */
export const revealFrom = { opacity: 0, y: 12 };
export const revealTo = { opacity: 1, y: 0 };
