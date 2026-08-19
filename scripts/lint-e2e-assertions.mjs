#!/usr/bin/env node
/**
 * e2e assertion linter — the status-array rule.
 *
 * `expect([200, 403]).toContain(response.status())` sat in this project's
 * auth spec for eleven revisions. The 200 branch was the Telegram webhook
 * accepting UNAUTHENTICATED updates, which would bind a stranger's alert
 * stream to whoever asked. The assertion could not fail, its comment said
 * the 200 meant "ignored", and it was reported as coverage the whole time.
 *
 * The shape is reflexive, which is the argument for a linter rather than
 * a habit: while sweeping the suite FOR this pattern I wrote a fresh
 * `expect([401, 405]).toContain(status)` one commit earlier, in a security
 * spec, for a route whose answer is not conditional at all.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────
 *
 * A multi-status assertion is a BUG when one of the accepted answers IS
 * the failure state and nothing downstream distinguishes them. It is
 * LEGITIMATE when both branches are handled and the actual subject is
 * asserted identically either way.
 *
 * That distinction cannot be checked mechanically — it is about what the
 * test means. So this does not try. It requires every status array to be
 * listed below with a one-line justification, which turns a reflex into a
 * decision somebody had to write down and a reviewer can disagree with.
 *
 * Usage: node scripts/lint-e2e-assertions.mjs [dir]
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, process.argv[2] ?? "apps/web/e2e");

/**
 * Every permitted status array, by the file it lives in and the reason it
 * is not the bug above. Adding an entry is the point of the exercise:
 * it is cheap, and it is a sentence somebody has to be willing to write.
 */
const JUSTIFIED = [
  {
    file: "auth-isolation.spec.ts",
    statuses: [200, 503],
    why:
      "link-telegram answers 200 with a bot username configured and 503 without, and the test HANDLES both — " +
      "the 503 branch writes the row the route would have written. The subject is that user B cannot reach " +
      "user A's channel, and that is asserted identically either way. Neither status is the failure state.",
  },
];

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => join(dir, f));

/**
 * An array of two or more HTTP status codes.
 *
 * Two narrowings, both learned from the first run of this file, which
 * flagged `[390, 767]` and `[360, 390]` — viewport widths. Three-digit
 * numbers in an array are not evidence of anything on their own.
 *
 *   1. every member must be inside the real status range (100-599);
 *   2. the surrounding lines must mention `status`.
 *
 * The window is +/-4 lines rather than the same line, because the shape
 * this exists to catch is usually formatted across several:
 *
 *     expect(
 *       [200, 503],
 *       "...",
 *     ).toContain(link.status());
 *
 * A checker that only read one line would miss precisely the occurrence
 * that started all this.
 */
const STATUS_ARRAY = /\[\s*\d{3}\s*(?:,\s*\d{3}\s*)+\]/g;
const WINDOW = 4;

const findings = [];
const used = new Set();

for (const file of files) {
  const name = relative(dir, file).replace(/\\/g, "/");
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    // Comments are where the reasoning lives, including quoted examples of
    // the bad pattern. Only real code is flagged.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const match of line.matchAll(STATUS_ARRAY)) {
      const statuses = match[0]
        .slice(1, -1)
        .split(",")
        .map((n) => Number(n.trim()));
      // Real status codes only — 767 is a viewport, not a response.
      if (!statuses.every((code) => code >= 100 && code <= 599)) continue;
      // ...and it must actually be compared against one.
      const near = lines.slice(Math.max(0, i - WINDOW), i + WINDOW + 1).join("\n");
      if (!/status/i.test(near)) continue;
      const entry = JUSTIFIED.find(
        (j) =>
          j.file === name &&
          j.statuses.length === statuses.length &&
          j.statuses.every((s) => statuses.includes(s)),
      );
      if (entry) {
        used.add(`${entry.file}:${entry.statuses.join(",")}`);
        continue;
      }
      findings.push({ file: name, line: i + 1, code: line.trim(), statuses });
    }
  });
}

if (findings.length) {
  console.error(
    `e2e assertions: ${findings.length} unjustified status array${findings.length === 1 ? "" : "s"}\n`,
  );
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.code}`);
  }
  console.error(
    "\nA multi-status assertion is a BUG when one of the accepted answers IS the\n" +
      "failure state and nothing downstream distinguishes them. If exactly one status\n" +
      "is correct, assert that one. If both are genuinely possible and both are\n" +
      "handled, add an entry to JUSTIFIED in scripts/lint-e2e-assertions.mjs saying so.",
  );
  process.exit(1);
}

const stale = JUSTIFIED.filter((j) => !used.has(`${j.file}:${j.statuses.join(",")}`));
console.log(
  `e2e assertions ok — ${files.length} spec files, ${JUSTIFIED.length} justified status array${JUSTIFIED.length === 1 ? "" : "s"}` +
    (stale.length
      ? `\n  stale justification, no longer present: ${stale.map((j) => j.file).join(", ")}`
      : ""),
);
