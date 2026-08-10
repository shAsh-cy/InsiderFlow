#!/usr/bin/env node
/**
 * CHANGELOG linter.
 *
 * This project's changelog is not decoration. AGPL-3.0 puts the source in
 * front of anyone who uses the service, and the changelog is the only
 * place that says what a given revision actually changed and why — the
 * commit subjects say what moved, not what it cost or what was measured.
 * A section that goes missing is a hole in that record, and holes are
 * only ever noticed later, by someone who needed the entry.
 *
 * So the shape is checked rather than trusted. Every section carries:
 *
 *   ## r<N>[.<M>] (YYYY-MM-DD) — <title>
 *   <!-- commits: <short-sha> ... -->
 *
 * and the linter asserts:
 *
 *   1. the file opens with `# Changelog`;
 *   2. every `##` heading matches that form;
 *   3. every section declares a commit manifest, and every hash in it
 *      resolves to a real commit in this repository — which is what makes
 *      "the r7 section matches the r7 commits" a checkable claim rather
 *      than a promise;
 *   4. no commit is claimed by two sections;
 *   5. revisions run newest-first, dates never increase going down, and
 *      the integer revisions are contiguous down to r1 — a missing rN is
 *      exactly the failure this exists to catch;
 *   6. no section is empty.
 *
 * Usage: node scripts/lint-changelog.mjs [path] [--no-git]
 * `--no-git` skips rule 3, for a checkout without history (shallow CI
 * clones, source tarballs). Everything else still runs.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const noGit = args.includes("--no-git");
const file = resolve(root, args.find((a) => !a.startsWith("--")) ?? "CHANGELOG.md");

const HEADING = /^## r(\d+)(?:\.(\d+))? \((\d{4}-\d{2}-\d{2})\) — (.+)$/;
const MANIFEST = /^<!-- commits: ((?:[0-9a-f]{7,40}\s*)+)-->$/;

const errors = [];
const fail = (line, message) => errors.push(`${file}:${line}  ${message}`);

const lines = readFileSync(file, "utf8").split(/\r?\n/);

if (lines[0] !== "# Changelog") {
  fail(1, `the file must open with "# Changelog", found ${JSON.stringify(lines[0] ?? "")}`);
}

/** Every `##` line, so a malformed heading is caught rather than skipped. */
const sections = [];
lines.forEach((text, i) => {
  if (!text.startsWith("## ")) return;
  const line = i + 1;
  const m = HEADING.exec(text);
  if (!m) {
    fail(line, `heading is not "## r<N>[.<M>] (YYYY-MM-DD) — <title>": ${JSON.stringify(text)}`);
    return;
  }
  const [, major, minor, date, title] = m;
  if (Number.isNaN(Date.parse(date))) fail(line, `"${date}" is not a real date`);
  sections.push({
    line,
    id: minor ? `r${major}.${minor}` : `r${major}`,
    order: [Number(major), Number(minor ?? 0)],
    date,
    title,
    commits: [],
    body: 0,
  });
});

if (sections.length === 0) fail(1, "no revision sections found");

// Manifest + body, read from each heading to the next one.
sections.forEach((section, index) => {
  const end = index + 1 < sections.length ? sections[index + 1].line - 1 : lines.length;
  let manifestLine = 0;
  for (let i = section.line; i < end; i += 1) {
    const text = lines[i].trim();
    if (!text) continue;
    const m = MANIFEST.exec(text);
    if (m) {
      if (manifestLine) fail(i + 1, `${section.id} declares a second commit manifest`);
      manifestLine = i + 1;
      section.commits = m[1].trim().split(/\s+/);
      continue;
    }
    if (text === "---") continue;
    section.body += 1;
  }
  if (!manifestLine) {
    fail(section.line, `${section.id} has no "<!-- commits: ... -->" manifest`);
  }
  if (section.body === 0) fail(section.line, `${section.id} has no body`);
});

// Every claimed commit is real, and claimed once.
const seen = new Map();
for (const section of sections) {
  for (const sha of section.commits) {
    const owner = seen.get(sha);
    if (owner) fail(section.line, `${sha} is claimed by both ${owner} and ${section.id}`);
    else seen.set(sha, section.id);
    if (noGit) continue;
    try {
      execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: root, stdio: "ignore" });
    } catch {
      fail(section.line, `${section.id} claims ${sha}, which is not a commit in this repository`);
    }
  }
}

// Newest first, dates never increasing, integers contiguous down to r1.
for (let i = 1; i < sections.length; i += 1) {
  const above = sections[i - 1];
  const below = sections[i];
  const descends =
    above.order[0] > below.order[0] ||
    (above.order[0] === below.order[0] && above.order[1] > below.order[1]);
  if (!descends) {
    fail(below.line, `${below.id} must come before ${above.id} — the file is newest first`);
  }
  if (below.date > above.date) {
    fail(below.line, `${below.id} (${below.date}) is dated after ${above.id} (${above.date})`);
  }
}

const majors = [...new Set(sections.map((s) => s.order[0]))].sort((a, b) => b - a);
for (let expected = majors[0]; expected >= 1; expected -= 1) {
  if (!majors.includes(expected)) {
    fail(
      1,
      `r${expected} has no section — every revision from r1 to r${majors[0]} must be recorded`,
    );
  }
}

if (errors.length) {
  console.error(`CHANGELOG: ${errors.length} problem${errors.length === 1 ? "" : "s"}\n`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

const ids = sections.map((s) => s.id).join(", ");
console.log(
  `CHANGELOG ok — ${sections.length} sections (${ids}), ${seen.size} commits${noGit ? " (git check skipped)" : " verified"}`,
);
