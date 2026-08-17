import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests. Install browsers once: pnpm exec playwright install chromium
 *
 * ── THE DEFAULT IS A PRODUCTION BUILD ON :3100 (r12) ──────────────────
 *
 * It used to be `pnpm dev` on :3000, and that default could corrupt its
 * own subject. `next dev` and `next start` write to and read from the SAME
 * `.next` directory: start a dev server while a production server is
 * running and the dev compiler rewrites the build under it. Observed
 * during the r11 sweep — the landing page came back with no stylesheet at
 * all and fifteen tests failed reporting that a version string was set in
 * "Times New Roman". Every one of those failures was false, and the real
 * cause was the harness, not the product. A test harness that can do that
 * is a correctness hazard for every phase after it.
 *
 * So: `pnpm test:e2e` starts `next build && next start -p 3100` itself and
 * points at that. Three consequences, all wanted — the suite measures the
 * artefact that ships rather than a dev bundle with different chunking,
 * CSP and caching; nothing writes to `.next` while it runs; and the port
 * differs from the dev default, so a developer's own `pnpm dev` on :3000
 * is untouched by a test run.
 *
 * `PLAYWRIGHT_BASE_URL` still overrides everything and skips the managed
 * server, which is how CI points at a deployed preview and how a local run
 * reuses a server that is already up.
 */
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

/** The port the managed production server binds. Not 3000: see above. */
const MANAGED_PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  // Pings Postgres before any project starts and aborts with a named
  // failure if it is down, empty or stale. Without it those three states
  // arrive as timeouts and freshness failures, which read as regressions
  // in whatever was changed last — see the file for the two incidents.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  /**
   * CAPPED, because the default oversubscribes and the suite stops being
   * trustworthy when it does.
   *
   * Playwright defaults to about one worker per two cores — 8 on this
   * 16-core box. Measured there, `layout.spec.ts` failed 5 to 7 tests per
   * run with a DIFFERENT set each time, every one of them `page.goto:
   * Test timeout of 30000ms exceeded` rather than an assertion. The same
   * file is 35/35 at two workers and 29/35 at eight, and the server is
   * not the bottleneck: measured directly it answers /trades in 289ms
   * serially and 379ms under eight concurrent requests, with 7 of 100
   * Postgres connections in use. What saturates is the machine running
   * eight Chromium instances that each load a full page of client JS
   * while Docker and Postgres share the same cores.
   *
   * A suite that fails a different handful of tests every run is worse
   * than a slow one: it teaches everyone to re-run rather than read, and
   * the first real regression then arrives dressed as noise. Four is
   * green and repeatable here — 266 expected, 0 unexpected, 0 flaky —
   * and CI runners are 2-core, so they get two.
   *
   * A ceiling, not a target. The `perf` project still runs alone via
   * `dependencies` because it measures the machine, and the serial
   * `stream` project is unchanged; both are still needed.
   */
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: externalBaseUrl ?? `http://localhost:${MANAGED_PORT}`,
    trace: "on-first-retry",
  },
  /**
   * Two projects, because one test measures the MACHINE.
   *
   * The 10k-row scroll asserts a frame budget. Run alongside seven other
   * Chromium instances on the same box it measures how oversubscribed the
   * CPU is, which is a true fact about the runner and no fact at all
   * about the product — it failed under eight workers and passed alone,
   * every time. Loosening the budget to accommodate that would delete the
   * only thing the test is for.
   *
   * So the perf test runs in its own project, gated behind the rest via
   * `dependencies`. By the time it starts, nothing else is running and
   * the number means what it claims to.
   */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /60fps|@mobile|@stream/,
    },
    /**
     * The mobile matrix.
     *
     * Every test in the r3 suite ran at 1280x720 — no `setViewportSize`, no
     * device descriptor, no `hasTouch` anywhere — so 140 tests only ever
     * exercised the >=1024px branch of every responsive rule. The sidebar was
     * always visible and no mobile layout was executed even once.
     *
     * `hasTouch` and `isMobile` are the load-bearing part, not the viewport:
     * they are what makes `(hover: hover) and (pointer: fine)` evaluate false,
     * which is the condition every hover-gated affordance in this product is
     * written against. A narrow desktop window is not a phone, and testing one
     * as though it were the other is how the touch path stays broken.
     *
     * Specs opt in with `@mobile` in their title; `chromium` excludes the same
     * tag so nothing runs twice.
     */
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      },
      grep: /@mobile/,
      grepInvert: /60fps|@stream/,
    },
    /**
     * The live-stream tests, for the same reason as `perf` and a different
     * shared resource.
     *
     * `/api/stream` caps concurrent SSE connections at four per IP, and
     * every worker on this box is the same IP. Two tests need a real
     * connection AND a row to arrive over it; run beside seven other
     * workers they were starved by a limit that is the product working as
     * designed, and they had been carrying `retries: 2` to paper over it.
     * A retry that exists to survive the suite's own contention is a test
     * that has stopped measuring the product.
     *
     * So they run alone, after everything else. The retries are gone with
     * the contention, and a failure here means something is actually wrong.
     */
    {
      name: "stream",
      use: { ...devices["Desktop Chrome"] },
      grep: /@stream/,
      fullyParallel: false,
      workers: 1,
      dependencies: ["chromium", "mobile"],
    },
    {
      name: "perf",
      use: { ...devices["Desktop Chrome"] },
      grep: /60fps/,
      fullyParallel: false,
      dependencies: ["stream"],
    },
  ],
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          // `build` then `start`, never `dev` — see the note at the top of
          // this file. The build is what makes this slow to start and what
          // makes the run mean something.
          command: `pnpm exec next build && pnpm exec next start -p ${MANAGED_PORT}`,
          url: `http://localhost:${MANAGED_PORT}`,
          // Reusing a server that is already up is what makes an iterative
          // local run bearable; in CI there is never one to reuse and a
          // stale one would be a silent lie.
          reuseExistingServer: !process.env.CI,
          // A cold production build is minutes, not seconds.
          timeout: 600_000,
          // The suite needs the synthetic ZZ* fixtures visible, and the
          // managed server has to be told so explicitly — a developer's
          // shell usually has this set and CI's does not, which is exactly
          // the kind of difference that produces a green laptop and a red
          // pipeline.
          env: { INSIDERFLOW_SHOW_SYNTHETIC: "true" },
        },
      }),
});
