#!/usr/bin/env node
/**
 * THE WORKER'S CRON TRIGGERS, ASSERTED BEFORE AND AFTER A DEPLOY.
 *
 * A Cloudflare worker with no cron trigger deploys green and then never runs.
 * There is no error, no failed invocation and no log line — the ingestion
 * simply stops, and the first person to notice is a visitor looking at a feed
 * that stopped updating. That is the same silent-zero shape as the RLS
 * fallback, and it gets the same treatment: check the artefact, not the
 * intention.
 *
 * Two facts are asserted:
 *
 *   1. `wrangler.jsonc` declares exactly the crons this project has decided
 *      on. Not "at least one" — exactly these, because a THIRD trigger
 *      appearing is also a change worth noticing: the free plan allows five
 *      per account and this worker's budget is two, with the reasoning
 *      recorded in wrangler.jsonc itself.
 *   2. They are within the free plan's limit.
 *
 * ── WHY THIS IS A FILE AND NOT AN INLINE `node -e` IN THE WORKFLOW ────
 *
 * It started as one, and it failed on the real config: `wrangler.jsonc` is
 * JSONC, so it carries `//` comments AND trailing commas, and `JSON.parse`
 * rejects the trailing commas even after the comments are stripped. A gate
 * that cannot read the file it is gating is worse than no gate, and inline
 * YAML one-liners are where that goes unnoticed — this one is linted by
 * `pnpm lint:scripts` and runnable by hand.
 *
 * Usage: node scripts/assert-worker-crons.mjs [path/to/wrangler.jsonc]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(root, process.argv[2] ?? "ingestion/edgar-worker/wrangler.jsonc");

/** The decision, restated here so a change to either side has to meet the other. */
const EXPECTED = ["* * * * *", "0 * * * *"];
/** Cloudflare Workers Free: 5 cron triggers per account. */
const FREE_PLAN_LIMIT = 5;

/**
 * JSONC → JSON.
 *
 * Walks the text rather than running regexes over it, because a `//` inside a
 * string literal is not a comment and a regex cannot tell the difference. The
 * config carries `"$schema": "node_modules/wrangler/config-schema.json"`
 * today, which has no `//`, but a URL landing in this file later would
 * silently truncate the rest of the config and the failure would look like a
 * missing cron.
 */
function stripJsonc(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  // Trailing commas, which JSONC allows and JSON.parse does not.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

const fail = (title, ...lines) => {
  console.error(`\n${title}\n`);
  for (const line of lines) console.error(`  ${line}`);
  console.error("");
  process.exit(1);
};

let config;
try {
  config = JSON.parse(stripJsonc(readFileSync(file, "utf8")));
} catch (error) {
  fail(
    "WRANGLER CONFIG COULD NOT BE PARSED",
    `${file}`,
    error instanceof Error ? error.message : String(error),
  );
}

const crons = config?.triggers?.crons ?? [];

if (crons.length === 0) {
  fail(
    "THE WORKER DECLARES NO CRON TRIGGERS",
    "It would deploy successfully and then never run. Ingestion would stop",
    "with no error and no log line, and the first person to notice would be a",
    "visitor looking at a feed that had quietly stopped.",
  );
}

if (crons.length > FREE_PLAN_LIMIT) {
  fail(
    "TOO MANY CRON TRIGGERS FOR THE FREE PLAN",
    `${crons.length} declared, and Cloudflare Workers Free allows ${FREE_PLAN_LIMIT} per account.`,
  );
}

const same =
  crons.length === EXPECTED.length && EXPECTED.every((value, index) => crons[index] === value);

if (!same) {
  fail(
    "THE CRON TRIGGERS ARE NOT THE ONES THIS PROJECT DECIDED ON",
    `expected: ${EXPECTED.map((c) => `"${c}"`).join(", ")}`,
    `found:    ${crons.map((c) => `"${c}"`).join(", ")}`,
    "",
    "This is not a lint failure to route around. wrangler.jsonc records why",
    "there are two and what the other three are being saved for; if the answer",
    "has changed, change it there and here together.",
  );
}

console.log(
  `worker crons ok — ${crons.map((c) => `"${c}"`).join(", ")} ` +
    `(${crons.length} of the free plan's ${FREE_PLAN_LIMIT})`,
);
