import { defineConfig } from "vitest/config";

/**
 * Both suites in this package boot PGlite — a full Postgres compiled to
 * WebAssembly — and run every migration against it. Two of those heaps live
 * at once under the default parallel file runner, which on a modest machine
 * ends in `VirtualAlloc failed` rather than a test failure, and in the milder
 * case just makes the run take minutes.
 *
 * The root `test` script already serialises across packages for the same
 * reason (`--workspace-concurrency=1`); this does it within one.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
