import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * ACCESSIBILITY, ENFORCED RATHER THAN REMEMBERED.
 *
 * Ten UI revisions were built against "axe: zero contrast violations across
 * fifteen routes in both themes". r15 went looking for that gate and found
 * that **it does not exist in this repository** — no axe dependency, no
 * spec, nothing in CI. The number came from scratchpad scripts that were
 * never committed, so every claim resting on it rested on nothing a fresh
 * clone could reproduce. This file is that gate, committed.
 *
 * ── WHY `incomplete` IS ASSERTED, NOT JUST `violations` ───────────────
 *
 * The historically load-bearing check here is contrast, and the way it
 * failed before was not a missed violation — it was a sweep that measured
 * the wrong composited ground and passed. axe does not have that bug: it
 * walks ancestors to resolve the real background. But when it CANNOT
 * resolve one — a background image, an unresolvable alpha stack, an
 * element mid-transition — it does not guess and it does not report a
 * violation. It reports `incomplete`.
 *
 * A page whose every contrast check landed in `incomplete` therefore has
 * ZERO violations and zero evidence. Reading that as a pass is exactly the
 * mistake that produced the false green the first time, so `incomplete`
 * for the contrast rule is a failure here, and its nodes are printed.
 *
 * ── AND WHY BOTH THEMES ───────────────────────────────────────────────
 *
 * The palette is dark-first with an explicit `.light` opt-in class, so the
 * two themes are different colour sets, not an inversion. A token that
 * clears 4.5:1 on ink-on-paper can fail on paper-on-ink, and only one of
 * the two is what a given visitor sees.
 */

/**
 * The fifteen. Dynamic segments use seeded synthetic fixtures, which is
 * why they are literal here — a route that 404s renders an error page, and
 * an error page passes axe while proving nothing about the route.
 */
const ROUTES = [
  "/",
  "/trades",
  "/screener",
  "/heatmap",
  "/leaderboard",
  "/companies",
  "/politicians",
  "/watchlist",
  "/settings",
  "/docs",
  "/docs/methodology",
  "/design",
  "/legal",
  "/login",
  "/status",
] as const;

type Theme = "dark" | "light";
const THEMES: Theme[] = ["dark", "light"];

/**
 * Choose the theme the way a returning visitor does.
 *
 * `next-themes` is configured `attribute="class"` with `enableSystem`
 * false and `storageKey: "insiderflow-theme"`, so a stored preference is
 * the only input. Writing it before navigation exercises the real
 * anti-flash script instead of forcing a class on afterwards — which
 * would test a state the product never actually paints.
 */
async function visit(page: Page, route: string, theme: Theme): Promise<void> {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    ["insiderflow-theme", theme],
  );
  /*
   * Reduced motion, because a MOVING element has no measurable ground.
   *
   * The first run of this spec reported 17 unresolved contrast nodes on
   * `/` alone, every one of them inside the live tape — `li[data-tape-
   * ticker]` and its children, which scroll continuously. axe resolves a
   * composited background by walking ancestors and reading their computed
   * colours; under an active transform it cannot say what is behind a
   * given pixel, so it declines to decide and reports `incomplete`.
   *
   * That is axe being careful, not axe being broken, and it is the same
   * class of problem as the `boundingBox()` reads this suite has fixed
   * nine times: measuring something mid-animation.
   *
   * `prefers-reduced-motion: reduce` is not a test-only escape hatch here.
   * The product already honours it — `loading.spec.ts` asserts the shimmer
   * stops — so this scans a state real visitors get, and it is the state
   * in which the question "what colour is behind this text" has an answer.
   */
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(route, { waitUntil: "networkidle" });
  // The class is what every token in the palette keys off. If it is absent
  // the page is being scanned in the other theme and the run is a lie.
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
}

const scan = (page: Page) =>
  new AxeBuilder({ page })
    // WCAG 2.1 AA — the bar this project states in its design language.
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

/** Readable failure text: rule, impact, and the nodes, not a JSON dump. */
const describe_ = (
  nodes: Array<{ id?: string; impact?: string | null; nodes: Array<{ target: unknown[] }> }>,
): string =>
  nodes
    .map(
      (r) =>
        `  ${r.id} (${r.impact ?? "n/a"}) — ${r.nodes.length} node(s)\n` +
        r.nodes
          .slice(0, 5)
          .map((n) => `      ${String(n.target)}`)
          .join("\n"),
    )
    .join("\n");

/**
 * `incomplete` has two very different meanings, and only one is a problem.
 *
 * axe reports `incomplete` for colour-contrast whenever it will not commit
 * to an answer. Sometimes that is because it CANNOT SEE THE GROUND — a
 * background image, an overlap, a pseudo-element — and that is the case
 * this gate exists to catch, because zero violations on an element nobody
 * could measure is precisely the false green that produced the original
 * uncommitted "zero contrast violations" claim.
 *
 * Sometimes it is because THERE IS NO TEXT TO JUDGE. The tape renders
 * direction as `▲` and `▼`, and axe correctly declines to apply a
 * text-contrast rule (WCAG 1.4.3) to an element whose entire content is a
 * symbol. That is not a gap in the measurement, it is the right rule
 * declining a case outside its scope.
 *
 * So the ground reasons fail, the known non-text reason is allowed by
 * name, and ANYTHING ELSE fails — a new reason means something changed
 * that nobody has read.
 */
const UNRESOLVED_GROUND = /could not be determined|[Uu]nable to determine/;

const EXPECTED_INCOMPLETE = [
  // The ▲/▼ direction glyphs in the tape and the trade tables. Governed by
  // WCAG 1.4.11 (non-text contrast, 3:1) rather than 1.4.3, which axe does
  // not evaluate here — so these glyphs are NOT covered by this gate, and
  // saying so is more useful than a green tick that implies they are.
  "Element content contains only non-text characters",
];

const OVERLAPPED =
  "Element's background color could not be determined because it is overlapped by another element";
const PSEUDO = "Element's background color could not be determined due to a pseudo element";

/**
 * WHAT THIS GATE CANNOT CURRENTLY MEASURE, ROUTE BY ROUTE.
 *
 * A baseline, not a relaxation, and the difference matters. The assertion
 * is set EQUALITY: a route that grows a new unresolvable reason fails, and
 * so does a route that stops having one and is left listed here. The
 * second half is what stops this table becoming a place things go to be
 * forgotten.
 *
 * Recorded honestly rather than tuned away. Three routes have elements
 * whose composited ground axe declines to compute:
 *
 *   /heatmap  the treemap draws cells that overlap their own labels, so
 *             the label's ground is another element's paint.
 *   /screener a pseudo-element (the sticky first column's edge rule)
 *             sits between text and its background.
 *   /design   both, being the page that renders every primitive at once.
 *
 * None of these is known to be a contrast FAILURE — they are unjudged,
 * which is a weaker statement than "passing" and is written as such. The
 * honest fix is to give those elements an opaque ground of their own so
 * axe can decide; that is a design change and it is not in this round.
 */
const UNMEASURABLE: Record<string, string[]> = {
  "/heatmap": [OVERLAPPED],
  "/screener": [PSEUDO],
  "/design": [OVERLAPPED, PSEUDO].sort(),
};

/** Every distinct reason axe gave for declining a contrast judgement. */
function contrastIncompleteReasons(
  incomplete: Awaited<ReturnType<typeof scan>>["incomplete"],
): Set<string> {
  const reasons = new Set<string>();
  for (const rule of incomplete) {
    if (rule.id !== "color-contrast") continue;
    for (const node of rule.nodes) {
      for (const key of ["any", "all", "none"] as const) {
        for (const check of node[key] ?? []) {
          if (check.message) reasons.add(check.message);
        }
      }
    }
  }
  return reasons;
}

for (const theme of THEMES) {
  test.describe(`axe — ${theme}`, () => {
    for (const route of ROUTES) {
      test(`${route} has no WCAG 2.1 AA violations`, async ({ page }) => {
        await visit(page, route, theme);
        const results = await scan(page);

        expect(results.violations, `\n${describe_(results.violations)}\n`).toEqual([]);

        // Contrast must have been DECIDED, not deferred — but only where
        // deferring would hide a real answer. See REASONS below.
        const reasons = contrastIncompleteReasons(results.incomplete);

        const unresolvedGround = [...reasons].filter((m) => UNRESOLVED_GROUND.test(m)).sort();
        expect(
          unresolvedGround,
          `\naxe could not resolve the composited background on ${route} (${theme}), and the ` +
            `set of reasons is not the one recorded in UNMEASURABLE. That is not a pass — it ` +
            `is an element nobody measured, which is how the previous contrast sweep passed ` +
            `falsely. Fix it, or record it there with a reason.\n`,
        ).toEqual(UNMEASURABLE[route] ?? []);

        const unrecognised = [...reasons].filter(
          (m) => !UNRESOLVED_GROUND.test(m) && !EXPECTED_INCOMPLETE.includes(m),
        );
        expect(
          unrecognised,
          `\naxe declined to judge contrast for a reason this suite has not looked at. ` +
            `Read it, decide whether it hides a real failure, and either fix it or add ` +
            `it to EXPECTED_INCOMPLETE with a note.\n`,
        ).toEqual([]);

        // And it must have actually run. A page where the rule is absent
        // from every bucket has been scanned by a configuration that does
        // not include it, which is how a gate quietly stops gating.
        const ran = [...results.passes, ...results.violations, ...results.incomplete].some(
          (r) => r.id === "color-contrast",
        );
        expect(ran, `color-contrast did not run on ${route} (${theme})`).toBe(true);
      });
    }
  });
}

/**
 * The gate, broken on purpose.
 *
 * Every assertion above is a negative — "no violations" — and a negative
 * passes just as happily when the tool is misconfigured, the page is
 * blank, or the selector matches nothing. This test injects a control that
 * axe MUST catch, so a green run means the scanner is looking.
 */
test.describe("the scanner is actually scanning", () => {
  test("axe reports a contrast failure that is really there", async ({ page }) => {
    await visit(page, "/", "dark");
    await page.evaluate(() => {
      const el = document.createElement("p");
      // #777 on #6f6f6f is ~1.06:1 — unreadable, and unambiguous: both are
      // opaque, so this is a background axe can resolve and must reject.
      el.setAttribute("style", "background:#6f6f6f;color:#777777;font-size:14px");
      el.textContent = "deliberate contrast failure";
      document.body.append(el);
    });
    const results = await scan(page);
    const contrast = results.violations.find((r) => r.id === "color-contrast");
    expect(
      contrast,
      "axe did not flag an unreadable element — the scan is not working",
    ).toBeTruthy();
  });

  test("axe reports a missing form label that is really there", async ({ page }) => {
    // A second, different rule: a scanner can be broken for one rule's
    // dependencies (contrast needs layout and paint) while another works.
    await visit(page, "/", "dark");
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.type = "text";
      document.body.append(input);
    });
    const results = await scan(page);
    expect(results.violations.map((r) => r.id)).toContain("label");
  });
});
