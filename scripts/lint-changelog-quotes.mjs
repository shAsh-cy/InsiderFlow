#!/usr/bin/env node
/**
 * Every quotation in a RECONSTRUCTED changelog section must be verbatim.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * r10 through r16 were written in r18 from git history, because no round
 * report was written at the time. That is archaeology, and archaeology has
 * a failure mode the rest of the changelog does not: a plausible sentence
 * about a round nobody documented is indistinguishable, a year later, from
 * a recorded one. Fabricated history is worse than absent history, because
 * absent history announces itself.
 *
 * `lint:changelog` already proves every claimed commit is real and claimed
 * once. It cannot see whether the PROSE describes those commits. This does
 * the other half for the reconstructed sections: every quoted fragment in
 * one must appear, verbatim, in a commit that same section claims.
 *
 * Sections r1-r9.2 and r17 were written by the round that did the work and
 * are exempt — their author had the round in front of them, and holding
 * contemporaneous narrative to a quotation standard would mean it could
 * only ever repeat its own commit messages.
 *
 * ── WHAT IT DOES NOT CHECK ────────────────────────────────────────────
 *
 * Unquoted prose in a reconstructed section. That prose is confined by
 * convention to structural statements — which commits a round contains,
 * that a round was abandoned, that something is not recoverable — and no
 * linter can tell an honest summary from a confident invention. The
 * convention is the control there; this is the control for figures, which
 * is where a wrong number would actually mislead someone.
 *
 * Usage: node scripts/lint-changelog-quotes.mjs [path]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(
  root,
  process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "CHANGELOG.md",
);

/**
 * The reconstructed sections. A list rather than a marker scan: adding a
 * section here is a deliberate act, and a typo in a banner should not
 * silently exempt a section from the check.
 */
const RECONSTRUCTED = new Set(["r16", "r15", "r14", "r13", "r12", "r11", "r10"]);

/** r10's commits are unreachable; its quotations come from the tag that saved them. */
const EXTRA_CORPUS = { r10: ["tag", "-n99", "-l", "abandoned/ui-ledger-r10"] };

const norm = (s) => s.replace(/\s+/g, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();

/**
 * Quoted spans, scanned as an alternating open/close sequence.
 *
 * NOT a `/"([^"]+)"/g` regex. That pairs the CLOSING quote of one fragment
 * with the OPENING quote of the next, so it extracts the connective prose
 * between two quotations and then reports it as untraceable — 29 false
 * failures on the first run of this file, every one of them the tool's
 * fault. Backtick spans are opaque, because a quoted JSON literal like
 * `{"acqNameList":[]}` would otherwise flip the state mid-sentence.
 */
function quotedSpans(text) {
  const out = [];
  let inQuote = false;
  let buf = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "`") {
      const close = text.indexOf("`", i + 1);
      const span = close === -1 ? text.slice(i) : text.slice(i, close + 1);
      if (inQuote) buf += span;
      i += span.length - 1;
      continue;
    }
    if (ch === '"') {
      if (inQuote) {
        out.push(buf);
        buf = "";
      }
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) buf += ch;
  }
  return out;
}

const lines = readFileSync(file, "utf8").split(/\r?\n/);
const heads = [];
lines.forEach((text, i) => {
  const m = /^## (r\d+(?:\.\d+)?) /.exec(text);
  if (m) heads.push({ id: m[1], line: i });
});

const errors = [];
let checked = 0;
const covered = new Set();

for (const { id, line } of heads) {
  if (!RECONSTRUCTED.has(id)) continue;
  covered.add(id);

  const next = heads.find((h) => h.line > line);
  const section = lines.slice(line, next ? next.line : lines.length);
  const manifest = /<!-- commits: ((?:[0-9a-f]{7,40}\s*)+)-->/.exec(section.join("\n"));
  if (!manifest) {
    errors.push(`${id}: no commit manifest`);
    continue;
  }

  let corpus = manifest[1]
    .trim()
    .split(/\s+/)
    .map((sha) => execFileSync("git", ["log", "-1", "--format=%B", sha], { encoding: "utf8" }))
    .join("\n");
  if (EXTRA_CORPUS[id]) {
    corpus += execFileSync("git", EXTRA_CORPUS[id], { encoding: "utf8" });
  }
  const haystack = norm(corpus);

  // Only from the figures block down. Above it sits the commit-subject
  // list, whose subjects carry their own quotation marks, and the banner,
  // which is r18's prose about the reconstruction rather than a quotation.
  const start = section.findIndex((t) => /^(Figures recorded|Recorded disposition)/.test(t));
  if (start === -1) continue;
  const tail = section.slice(start);

  const fragments = [
    ...quotedSpans(tail.join("\n")),
    ...tail.map((t) => /^> (.+)$/.exec(t)?.[1]).filter(Boolean),
  ];

  for (const fragment of fragments) {
    const wanted = norm(fragment);
    // Short spans are punctuation or a bare word; they carry no claim and
    // would match anywhere.
    if (wanted.length < 12) continue;
    checked += 1;
    if (!haystack.includes(wanted)) {
      errors.push(
        `${id}: not verbatim in any commit this section claims — ${JSON.stringify(wanted)}`,
      );
    }
  }
}

// A section that vanishes from the file must not quietly stop being checked.
for (const id of RECONSTRUCTED) {
  if (!covered.has(id)) errors.push(`${id} is listed as reconstructed but has no section`);
}

if (errors.length) {
  console.error(`CHANGELOG quotes: ${errors.length} problem${errors.length === 1 ? "" : "s"}\n`);
  for (const error of errors) console.error(`  ${error}`);
  console.error(
    "\nA reconstructed section may quote only what a commit actually says.\n" +
      "Rewrite the sentence, or drop the quotation marks and state it as summary.\n",
  );
  process.exit(1);
}

console.log(
  `CHANGELOG quotes ok — ${checked} fragments across ${covered.size} reconstructed sections, all verbatim`,
);
