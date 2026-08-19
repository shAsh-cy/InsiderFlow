import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * TWO BUILD-OUTPUT PROPERTIES THAT WERE ASSUMED RATHER THAN CHECKED.
 *
 * The r20 leak audit went in with both written down as already true. One was:
 * `productionBrowserSourceMaps` is gated on `ANALYZE === "1"`, and has been
 * since r17 put it there with a paragraph explaining why. The other was not —
 * `poweredByHeader` had never appeared in this repository at all, Next
 * defaults it to true, and every response of the production build carried
 * `X-Powered-By: Next.js`.
 *
 * The difference between the two is the whole point of this file: one had a
 * line of configuration and the other had a sentence in a checklist. So both
 * are asserted here, statically, and again over live responses in
 * `e2e/security-headers.spec.ts`. This half fails the moment the declaration
 * is deleted; that half fails if the declaration stops working.
 *
 * The config is read as TEXT and not imported. Importing it would run the
 * RLS build gate at the top of the file, which calls `process.exit(1)` when
 * a production stance has no APP_DATABASE_URL — taking the test runner with
 * it, from a test that is not about that.
 */

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const config = readFileSync(join(webRoot, "next.config.ts"), "utf8");

describe("next.config.ts", () => {
  it("disables the X-Powered-By header", () => {
    expect(config, "Next defaults poweredByHeader to true").toMatch(/poweredByHeader:\s*false/);
  });

  it("keeps browser source maps off unless a diagnostic build asks for them", () => {
    const setting = /productionBrowserSourceMaps:\s*([^,\n]+)/.exec(config)?.[1]?.trim();
    expect(setting, "productionBrowserSourceMaps must be declared").toBeTruthy();
    // `true` would publish the unminified source tree to every visitor; the
    // supported way to get maps is `ANALYZE=1 pnpm build`, which is a
    // per-invocation opt-in and is scanned for by lint:client-bundle.
    expect(setting).not.toBe("true");
    expect(setting).toContain("ANALYZE");
  });

  it("still installs the RLS build gate", () => {
    // Colocated on purpose: this file is the one a future round edits when
    // adding a build-output flag, and the gate lives three lines above it.
    expect(config).toMatch(/assertDbEnvOrExit\(process\.env/);
  });
});

describe("the client-bundle gate refuses source maps", () => {
  it("scans for .map files and exits on any", () => {
    // The gate that enforces the setting above at ARTEFACT level. A build run
    // with ANALYZE=1 and shipped by accident is the realistic failure, and no
    // amount of config assertion catches it — only looking at what came out.
    const script = readFileSync(join(webRoot, "../../scripts/lint-client-bundle.mjs"), "utf8");
    expect(script).toMatch(/endsWith\("\.map"\)/);
    expect(script).toContain("source map");
  });
});
