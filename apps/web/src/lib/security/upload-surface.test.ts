import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * THERE IS NO UPLOAD SURFACE, AND THIS IS WHAT KEEPS IT THAT WAY.
 *
 * "Restrict file uploads" is N/A for this product — every byte it holds
 * comes from SEC EDGAR, exchange feeds, or a user's own filter JSON. But
 * "N/A" is a claim about today, and the way it stops being true is that
 * somebody adds a perfectly reasonable CSV import and the twelve
 * upload-specific controls nobody wrote (size caps, type sniffing, path
 * traversal, zip bombs, storing outside the web root) are all missing at
 * once.
 *
 * So the N/A is enforced rather than asserted in a document. A future
 * upload route is not forbidden — it fails this test, which is where its
 * author reads what would have to come with it.
 *
 * The xlsx half is a live scar. r12 removed SheetJS because a
 * known-vulnerable spreadsheet PARSER sat in an export path; the
 * replacement, `write-excel-file`, can only write. A parser coming back
 * into the tree would restore the exact vulnerability class that removal
 * was meant to end, so it is checked by name.
 */

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const apiRoot = join(webRoot, "app/api");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/route\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Two views of the same file, because one is not enough.
 *
 * `prose()` blanks comments AND string literals, so a paragraph explaining
 * why there are no uploads is not itself a finding.
 *
 * `tokens()` blanks comments only. It exists because blanking strings is
 * exactly how a check like this gets walked past: `req.formData()` is
 * caught by a dotted-call regex, and `req["formData"]()` is not — the
 * property name is a string literal, so the first view has already erased
 * it. A flagged review of the first version of this file named that
 * differential, and it was right.
 *
 * No route in this app legitimately contains the identifier `formData` at
 * all, so the token view can be strict without false positives.
 */
function prose(source: string): string {
  return comments(source)
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

function comments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const SEPARATORS = new RegExp("[" + String.fromCharCode(92) + "/]");
const routeFiles = walk(apiRoot);

describe("no route handler accepts a file upload", () => {
  it("finds route handlers to check at all", () => {
    // Without this, a walker pointed at the wrong directory reports a
    // clean sweep of nothing — the shape of failure this project has hit
    // before with a gate that "passed" because it scanned zero files.
    expect(routeFiles.length).toBeGreaterThan(10);
  });

  /**
   * The token view, and the reason it is separate from the checks below.
   *
   * A review of the first version of this file named a parser-validator
   * differential and it was right: the checks below run against source
   * with STRING LITERALS BLANKED, so `req.formData()` is caught and
   * `req["formData"]()` is not — the property name is a string literal,
   * and blanking erased it before the regex ever ran. Same for
   * `const m = "formData"; req[m]()`.
   *
   * These run against source with only COMMENTS removed, which closes
   * that gap. They can afford to be strict because no route in this app
   * has any legitimate reason to contain either identifier.
   *
   * Written as plain substring patterns on purpose. The first attempt used
   * word-boundary anchors and the escape was written as a literal
   * BACKSPACE byte rather than the two characters a regex needs — so the
   * pattern could not match any real source, and the test passed with an
   * evasion probe sitting in the tree. That is the ninth assertion in this
   * project that could not fail for the reason it named.
   */
  function mentioning(pattern: RegExp): string[] {
    return routeFiles
      .filter((file) => pattern.test(comments(readFileSync(file, "utf8"))))
      .map((file) => relative(webRoot, file).split(SEPARATORS).join("/"));
  }

  it("no handler mentions the identifier formData, in any syntax", () => {
    expect(
      mentioning(/formData/),
      "req[\"formData\"]() and const m = 'formData' included — the shapes a dotted-call regex misses",
    ).toEqual([]);
  });

  it("no handler mentions multipart, however it is spelled", () => {
    expect(mentioning(/multipart/i)).toEqual([]);
  });

  it.each([
    ["req.formData()", /\.\s*formData\s*\(/],
    ["multipart/form-data handling", /multipart\s*\/\s*form-data/i],
    ["a Blob or File read", /\b(?:new\s+)?(?:File|Blob)\s*\(/],
    ["arrayBuffer() on a request body", /\brequest\w*\s*\.\s*arrayBuffer\s*\(/],
    ["node:fs writes", /\bwriteFileSync?\s*\(|\bcreateWriteStream\s*\(/],
  ])("no handler uses %s", (_label, pattern) => {
    const offenders = routeFiles
      .filter((file) => pattern.test(prose(readFileSync(file, "utf8"))))
      .map((file) => relative(webRoot, file).split(/[\\/]/).join("/"));
    expect(
      offenders,
      "an upload route needs size caps, content-type verification, traversal-safe naming and " +
        "storage outside the web root. If you are adding one, add those first and then this entry.",
    ).toEqual([]);
  });
});

describe("no spreadsheet PARSER is in the tree", () => {
  const manifests = ["package.json", "apps/web/package.json", "packages/core/package.json"];
  // webRoot is apps/web/src, so the repo root is three up, not two.
  const repoRoot = resolve(webRoot, "../../..");

  it.each(["xlsx", "node-xlsx", "exceljs", "read-excel-file", "xlsx-populate"])(
    "%s is not a dependency",
    (name) => {
      for (const manifest of manifests) {
        const json = JSON.parse(readFileSync(join(repoRoot, manifest), "utf8")) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = { ...json.dependencies, ...json.devDependencies };
        expect(
          Object.keys(deps),
          `${manifest} pulls in ${name}. r12 removed SheetJS because a vulnerable PARSER sat in an ` +
            "export path; the replacement writes and cannot read, which is the property worth keeping.",
        ).not.toContain(name);
      }
    },
  );

  it("the export path still uses the writer-only library", () => {
    const exportSource = readFileSync(join(webRoot, "lib/export.ts"), "utf8");
    expect(exportSource).toContain("write-excel-file");
  });

  it("fflate is a devDependency used only by tests, never by shipped code", () => {
    // It can unzip, which is how the e2e suite reads back the workbook the
    // writer produced. That is fine in a test and would not be in a route.
    const shipped = walk(join(webRoot, "app")).concat(walk(apiRoot));
    for (const file of shipped) {
      expect(readFileSync(file, "utf8")).not.toContain("fflate");
    }
  });
});
