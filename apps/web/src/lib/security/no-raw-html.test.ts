import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * REACT ESCAPES EVERYTHING IT INTERPOLATES. THIS KEEPS IT THAT WAY.
 *
 * `{value}` in JSX is escaped by React, which is why this product has no
 * XSS surface in its own markup despite rendering issuer names, insider
 * names, and filing footnotes it did not write. There is exactly one way
 * to opt out of that guarantee, and it is spelled out in the API on
 * purpose.
 *
 * So the check is the simple one: nobody has opted out. The value of
 * asserting it mechanically rather than trusting review is that the escape
 * hatch is reached for under deadline, to render a snippet of markup that
 * "comes from our own database" — which in this product means it came from
 * an SEC filing, which means it came from whoever wrote the filing.
 *
 * `packages/alerts/src/escaping.test.ts` covers the other half: Telegram
 * and email bodies, which this codebase builds as strings and where React
 * is not there to help.
 */

const webSrc = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const SEPARATORS = new RegExp("[" + String.fromCharCode(92) + "/]");
const sourceFiles = walk(webSrc).filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

/** Comments removed so a note ABOUT the API is not a use OF it. */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("no raw HTML injection point in the web app", () => {
  it("has source files to check", () => {
    // A scanner that silently walks zero files reports a clean sweep.
    expect(sourceFiles.length).toBeGreaterThan(100);
  });

  it("uses dangerouslySetInnerHTML nowhere", () => {
    const offenders = sourceFiles
      .filter((file) =>
        withoutComments(readFileSync(file, "utf8")).includes("dangerously" + "SetInnerHTML"),
      )
      .map((file) => relative(webSrc, file).split(SEPARATORS).join("/"));
    expect(
      offenders,
      "React escapes {value}; this is the only way to opt out. If a feature genuinely needs " +
        "markup, sanitize at the boundary and add the file here with the reason.",
    ).toEqual([]);
  });

  it("never assigns innerHTML or outerHTML directly", () => {
    // The non-React route to the same place, reachable from any effect.
    const offenders = sourceFiles
      .filter((file) =>
        /\.(?:inner|outer)HTML\s*=/.test(withoutComments(readFileSync(file, "utf8"))),
      )
      .map((file) => relative(webSrc, file).split(SEPARATORS).join("/"));
    expect(offenders).toEqual([]);
  });

  it("never calls insertAdjacentHTML or document.write", () => {
    const offenders = sourceFiles
      .filter((file) =>
        /insertAdjacentHTML\s*\(|document\s*\.\s*write(?:ln)?\s*\(/.test(
          withoutComments(readFileSync(file, "utf8")),
        ),
      )
      .map((file) => relative(webSrc, file).split(SEPARATORS).join("/"));
    expect(offenders).toEqual([]);
  });
});
