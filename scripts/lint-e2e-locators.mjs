#!/usr/bin/env node
/**
 * e2e locator linter.
 *
 * A Playwright suite is only worth its runtime if a green run means the
 * product works. The way that quietly stops being true is a locator that
 * names an implementation detail instead of the thing under test:
 *
 *   `page.locator("div.surface")`  — a Tailwind-era styling class. Restyle
 *     the card and the locator matches nothing. Playwright reports "not
 *     visible", which reads as a broken feature, and the next person marks
 *     the test flaky and retries it.
 *
 *   `page.locator("#sheet-min-value")` — an id chosen for a `<label for>`.
 *     The reader finds that field by its label; so should the test.
 *
 *   `page.locator("header")` — matched the masthead AND every page's own
 *     `<header>`. It was doing the right thing by accident, on pages that
 *     happened to have one.
 *
 * So: no class selectors and no id selectors inside a locator, except the
 * ones named below with a reason. Roles, labels, test-ids and semantic
 * `data-*` contracts are always fine — the first three are what a user
 * navigates by, and the fourth is a hook the product declares on purpose.
 *
 * Usage: node scripts/lint-e2e-locators.mjs [dir]
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, process.argv[2] ?? "apps/web/e2e");

/**
 * THE ALLOWLIST. Every entry is a selector fragment that is allowed to
 * appear inside a locator, with the reason it is not the anti-pattern
 * above. Add to this only when the selector IS the contract under test.
 */
const ALLOWED = [
  {
    pattern: "#main",
    why: "the skip link's target. The id is the contract — a skip link that points at a different id is the bug.",
  },
  {
    pattern: "#${id}",
    why: "anchor ids the test enumerates itself — 'every heading this page links to exists'. The ids ARE the subject, and they come from the page under test rather than from a stylesheet.",
  },
];

/**
 * Does this selector name a class or an id anywhere in it?
 *
 * Attribute selectors are removed first, because their VALUES routinely
 * contain both characters — `a[href='/docs/methodology']` names no class
 * and `[data-testid='nav-drawer']` names no id.
 *
 * What is left is checked for `.` or `#` anywhere, not just at a token
 * boundary. `div.surface` and `aside.sticky` are exactly the pattern this
 * exists to stop, and both hide their class behind an element name. `$` is
 * in the character class for the same reason: `` `#${id}` `` is an id
 * selector built by interpolation, and a template literal is not an
 * exemption.
 */
const namesClassOrId = (selector) => /[.#][A-Za-z_$-]/.test(selector.replace(/\[[^\]]*\]/g, ""));

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => join(dir, f));

const findings = [];
const usedAllowances = new Set();

for (const file of files) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    // Only the selector-string form. `getByRole`, `getByTestId`,
    // `getByLabel`, `filter({ hasText })` and friends are never flagged.
    for (const m of line.matchAll(/\.locator\(\s*([`'"])((?:\\.|(?!\1).)*)\1/g)) {
      const selector = m[2];
      if (!namesClassOrId(selector)) continue;
      const allowance = ALLOWED.find((a) => !a.retired && selector.includes(a.pattern));
      if (allowance) {
        usedAllowances.add(allowance.pattern);
        continue;
      }
      findings.push({
        file: relative(root, file).replace(/\\/g, "/"),
        line: i + 1,
        selector,
      });
    }
  });
}

if (findings.length) {
  console.error(
    `e2e locators: ${findings.length} class/id selector${findings.length === 1 ? "" : "s"} outside the allowlist\n`,
  );
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  .locator(${JSON.stringify(f.selector)})`);
  }
  console.error(
    "\nUse a role, a label, a test-id or a declared data-* hook — or add the\n" +
      "selector to ALLOWED in this file with the reason it is the contract.",
  );
  process.exit(1);
}

const live = ALLOWED.filter((a) => !a.retired);
const unused = live.filter((a) => !usedAllowances.has(a.pattern));
console.log(
  `e2e locators ok — ${files.length} spec files, 0 class/id selectors outside ${live.length} allowances` +
    (unused.length
      ? `\n  stale allowance, no longer used: ${unused.map((a) => a.pattern).join(", ")}`
      : ""),
);
