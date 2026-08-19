import { expect } from "@playwright/test";
import type { Locator } from "@playwright/test";

/**
 * Layout measurement that waits for layout.
 *
 * ── WHY THIS IS A SHARED MODULE AND NOT A THIRD LOCAL COPY ────────────
 *
 * `boundingBox()` does not auto-wait. It returns null for an element that
 * is attached but not yet laid out, and it returns a MID-TRANSITION box
 * for one that is still animating. `toBeVisible()` before it does not fix
 * either case: it resolves as soon as the element has a box, which is the
 * moment the box is least trustworthy.
 *
 * This project has now fixed that same bug four times — a sweep in r12,
 * then two instances the sweep missed, then a ninth found by a full-suite
 * run in r14. Every one presented identically: green in isolation, red
 * under load, and reported as `Cannot read properties of null` or a
 * target measuring 42 instead of 44, both of which read as a broken
 * CONTROL rather than an early MEASUREMENT.
 *
 * Two local helpers had already been written independently in
 * `layout.spec.ts` and `mobile-shell.spec.ts`, which is how the third,
 * fourth and ninth sites came to be missed: there was no single place to
 * find. There is now.
 */

/**
 * The element's box once it has one and has stopped changing.
 *
 * Polls until two consecutive reads agree, so a box captured while a
 * drawer is sliding or a dropdown is growing is not accepted as final.
 * Returns the settled box, so callers assert on a value rather than
 * inside a poll.
 */
export async function settledBox(locator: Locator, name: string) {
  let previous: { x: number; y: number; width: number; height: number } | null = null;
  let stable: { x: number; y: number; width: number; height: number } | null = null;

  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        if (!box) {
          previous = null;
          return false;
        }
        const same =
          previous !== null &&
          Math.round(previous.width) === Math.round(box.width) &&
          Math.round(previous.height) === Math.round(box.height) &&
          Math.round(previous.x) === Math.round(box.x) &&
          Math.round(previous.y) === Math.round(box.y);
        previous = box;
        if (same) stable = box;
        return same;
      },
      {
        message: `${name} never settled to a stable box`,
        timeout: 10_000,
        intervals: [50, 50, 100, 100, 200, 250, 500],
      },
    )
    .toBe(true);

  return stable!;
}

/** `settledBox`, for the common case of asserting one dimension. */
export async function settledWidth(locator: Locator, name: string): Promise<number> {
  return (await settledBox(locator, name)).width;
}
