import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * THE CONTENT-SECURITY-POLICY, over real requests.
 *
 * `src/lib/security/csp.test.ts` asserts the policy STRING is built
 * correctly. That is not the interesting half. The interesting half is
 * whether the nonce in the header is the nonce on the script tags, and
 * whether a real browser executing this app reports any violation —
 * neither of which a unit test on a string can reach.
 *
 * The failure this exists to catch is specific and quiet: a policy whose
 * nonce matches nothing renders a page that looks fine in the HTML and
 * runs no JavaScript at all.
 */

const DOCUMENT_ROUTES = [
  "/",
  "/trades",
  "/screener",
  "/design",
  "/leaderboard",
  "/settings",
  "/login",
];

/** Directive → value, from a policy header. */
function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name ?? "", values.join(" ")];
    }),
  );
}

const nonceOf = (policy: string): string | null =>
  /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1] ?? null;

/** Collects violations reported by the browser for the whole session. */
async function watchForViolations(page: Page): Promise<Array<Record<string, string>>> {
  const seen: Array<Record<string, string>> = [];
  await page.exposeFunction("__reportCspViolation", (v: Record<string, string>) => {
    seen.push(v);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (
        window as unknown as { __reportCspViolation: (v: Record<string, string>) => void }
      ).__reportCspViolation({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        sample: event.sample ?? "",
      });
    });
  });
  return seen;
}

test.describe("the content security policy", () => {
  test("every document route carries an enforced policy", async ({ request }) => {
    for (const route of DOCUMENT_ROUTES) {
      const response = await request.get(route);
      const policy = response.headers()["content-security-policy"];
      expect(policy, `${route} must carry an enforced CSP`).toBeTruthy();
      // Report-only is a deployment switch. If the suite ever sees the
      // report-only header instead, the policy is not enforcing and the
      // rest of this file is asserting nothing.
      expect(
        response.headers()["content-security-policy-report-only"],
        `${route} must not be report-only in a default deployment`,
      ).toBeUndefined();
    }
  });

  test("script-src is a nonce policy with no inline or eval escape", async ({ request }) => {
    const policy = (await request.get("/trades")).headers()["content-security-policy"] ?? "";
    const scriptSrc = directives(policy).get("script-src") ?? "";
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc, "an inline escape would make the nonce decorative").not.toContain(
      "'unsafe-inline'",
    );
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    // The clickjacking half, which has no meaning without the header.
    expect(directives(policy).get("frame-ancestors")).toBe("'none'");
    expect(directives(policy).get("object-src")).toBe("'none'");
    expect(directives(policy).get("base-uri")).toBe("'self'");
  });

  test("the nonce is different on every response", async ({ request }) => {
    // The property that makes a nonce a nonce. A policy built once at
    // module scope, or cached by a proxy, produces the same value twice
    // and is worth nothing — an injected script can simply read the
    // nonce off a sibling tag and reuse it.
    const nonces = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const policy = (await request.get("/trades")).headers()["content-security-policy"] ?? "";
      const nonce = nonceOf(policy);
      expect(nonce, "every response must carry a nonce").not.toBeNull();
      nonces.add(nonce ?? "");
    }
    expect(nonces.size, "five responses must produce five distinct nonces").toBe(5);
  });

  test("every script tag carries the nonce from its own response's header", async ({ request }) => {
    for (const route of ["/", "/trades", "/design"]) {
      const response = await request.get(route);
      const nonce = nonceOf(response.headers()["content-security-policy"] ?? "");
      const html = await response.text();

      const tags = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
      expect(tags.length, `${route} should render script tags at all`).toBeGreaterThan(5);

      // Every one of them, including the inline anti-flash script that
      // next-themes renders — Next stamps its OWN scripts automatically
      // and that one it does not, so it is passed the nonce explicitly.
      // Under report-only this was the single un-nonced tag out of forty.
      const unnonced = tags.filter((tag) => !tag.includes(`nonce="${nonce}"`));
      expect(
        unnonced,
        `${route} has ${unnonced.length} script tag(s) the policy would refuse: ${unnonced
          .map((t) => t.slice(0, 80))
          .join(" ")}`,
      ).toHaveLength(0);
    }
  });

  test("a real browser reports no violation while using the app", async ({ page }) => {
    const violations = await watchForViolations(page);

    for (const route of DOCUMENT_ROUTES) {
      await page.goto(route);
    }

    // The overlays, because runtime style and script injection lives in
    // portals rather than in server-rendered markup.
    await page.goto("/trades");
    await page.getByTestId("open-palette").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/screener");
    await page.getByTestId("save-alert").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");

    // A client-side navigation, which loads chunks through the injected
    // script path that 'strict-dynamic' exists to permit. Clicked rather
    // than `goto`-ed on purpose: a full navigation fetches a fresh
    // document with a fresh nonce, so it would never exercise the case
    // where the router injects a script into a page whose policy was
    // issued earlier.
    await page.goto("/trades");
    await page
      .getByTestId("sidebar")
      .getByRole("link", { name: /heatmap/i })
      .click();
    await expect(page).toHaveURL(/\/heatmap$/);
    await page.waitForLoadState("networkidle");

    expect(
      violations.map((v) => `${v.directive} blocked=${v.blocked} sample=${v.sample}`),
      "the policy must not refuse anything the app legitimately does",
    ).toEqual([]);
  });

  /*
   * REMOVED, and the removal is the point.
   *
   * There was a test here called "the theme is applied before paint,
   * which is what nonce-ing that script buys". It asserted that <html>
   * carries a `dark` or `light` class after `page.goto`. When the
   * next-themes nonce was deliberately removed and the anti-flash script
   * was genuinely refused by the policy, that test still PASSED — because
   * next-themes' React provider applies the same class on mount, and a
   * retrying locator assertion happily waits for hydration to do it.
   *
   * It could not fail for the reason it named, which is the exact shape
   * `scripts/lint-e2e-assertions.mjs` exists to keep out of this suite.
   * The un-nonced-script case IS caught, twice and for real: "every
   * script tag carries the nonce" fails on the tag, and "a real browser
   * reports no violation" fails on the browser's own report. A third
   * test that agrees with them only when they are already failing adds
   * nothing but a name that suggests coverage nobody has.
   */

  test("the API is deliberately outside the policy's matcher", async ({ request }) => {
    // Not an oversight — a JSON body has no document context for a
    // document policy to govern, and /api/* is excluded from the
    // middleware matcher so those responses stay shared-cacheable.
    // Asserted so that "the API has no CSP" reads as a decision.
    const response = await request.get("/api/health");
    expect(response.headers()["content-security-policy"]).toBeUndefined();
  });
});
