#!/usr/bin/env node
/**
 * ONE COMMAND: `pnpm deploy:prod`
 *
 * Dispatches .github/workflows/release.yml and then tells you where to click.
 * It does not deploy anything itself, and that is the design: the deploy runs
 * on GitHub's runners, behind the `production` environment's required
 * reviewer, using secrets that never touch a developer's machine.
 *
 * ── WHY A SCRIPT AND NOT A `gh workflow run` ALIAS ────────────────────
 *
 * Three things a bare alias gets wrong, each of which has cost this project a
 * session before:
 *
 *   1. It fails silently when `gh` is missing or logged out. A deploy command
 *      that prints nothing and exits 0 is indistinguishable from one that
 *      worked — the same failure shape as the PowerShell probes in
 *      docs/verify-windows.md.
 *   2. It says nothing about the approval. `gh workflow run` returns
 *      immediately, the run sits waiting for a reviewer, and the natural
 *      reading of a silent prompt is "it is deploying".
 *   3. It cannot refuse an obviously wrong ref. Dispatching a release from a
 *      dirty tree or a branch that is not the one CI verified is a mistake
 *      worth one confirmation.
 *
 * Usage:
 *   pnpm deploy:prod                        # dispatch from the current branch
 *   pnpm deploy:prod -- --ref=main
 *   pnpm deploy:prod -- --reason="hotfix: cursor fix"
 *   pnpm deploy:prod -- --dry-run-rollback  # forces smoke to fail on purpose
 *   pnpm deploy:prod -- --yes               # skip the confirmation prompt
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const WORKFLOW = "release.yml";

const args = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes(`--${name}`);

const die = (title, ...lines) => {
  console.error(`\n${title}\n`);
  for (const line of lines) console.error(`  ${line}`);
  console.error("");
  process.exit(1);
};

/** Run a command and return stdout, or null when it is not runnable at all. */
function run(command, commandArgs) {
  try {
    return execFileSync(command, commandArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    }).trim();
  } catch {
    return null;
  }
}

// ── The GitHub CLI has to be there and logged in ──────────────────────────
if (run("gh", ["--version"]) === null) {
  die(
    "THE GITHUB CLI IS NOT AVAILABLE",
    "`gh` is what dispatches the release. Install it:",
    "  winget install GitHub.cli      (Windows)",
    "  brew install gh                (macOS)",
    "Then: gh auth login",
  );
}
if (run("gh", ["auth", "status"]) === null) {
  die("THE GITHUB CLI IS NOT LOGGED IN", "Run: gh auth login");
}

// ── Which ref, and is the tree clean ──────────────────────────────────────
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]) ?? "HEAD";
const ref = flag("ref", branch);
const dirty = (run("git", ["status", "--porcelain"]) ?? "").length > 0;
const sha = run("git", ["rev-parse", "--short", "HEAD"]) ?? "unknown";

console.log("");
console.log("  Release to production");
console.log("  ---------------------");
console.log(`  workflow   ${WORKFLOW}`);
console.log(`  ref        ${ref}${ref === branch ? "  (current branch)" : ""}`);
console.log(`  local HEAD ${sha}${dirty ? "  ** UNCOMMITTED CHANGES **" : ""}`);
console.log(`  reason     ${flag("reason", "manual release")}`);
if (has("dry-run-rollback")) {
  console.log("  MODE       DRY RUN — smoke is forced to fail, rollback runs,");
  console.log("             DEPLOYMENT_ACTIVE is NOT flipped.");
}
console.log("");
console.log("  GitHub runs the deploy, not this machine. It will PAUSE at the");
console.log("  `production` environment and wait for a reviewer to approve.");
console.log("");

if (dirty) {
  // Not fatal — the dispatch runs whatever is on the remote ref, so local
  // dirt cannot reach production. It is worth one line, because thinking a
  // local edit is going out is a good way to deploy the wrong thing twice.
  console.log("  NOTE: your working tree has uncommitted changes. The release");
  console.log("        builds from the REMOTE ref above, so those changes are");
  console.log("        NOT included.");
  console.log("");
}

// ── Confirm ───────────────────────────────────────────────────────────────
if (!has("yes")) {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question("  Dispatch this release? [y/N] ")).trim().toLowerCase();
  rl.close();
  if (answer !== "y" && answer !== "yes") {
    console.log("\n  Cancelled. Nothing was dispatched.\n");
    process.exit(1);
  }
}

// ── Dispatch ──────────────────────────────────────────────────────────────
const fields = [
  "-f",
  `reason=${flag("reason", "manual release")}`,
  "-f",
  `force_smoke_failure=${has("dry-run-rollback")}`,
  "-f",
  `skip_worker=${has("skip-worker")}`,
];

const dispatch = spawnSync("gh", ["workflow", "run", WORKFLOW, "--ref", ref, ...fields], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (dispatch.status !== 0) {
  die(
    "DISPATCH FAILED",
    "`gh workflow run` exited non-zero — the message above is from gh.",
    "Common causes: the workflow is not on the default branch yet, the ref",
    "does not exist on the remote, or the token lacks `workflow` scope.",
  );
}

console.log("");
console.log("  Dispatched. Next:");
console.log("");
console.log("    gh run watch          # follow it");
console.log("    gh run list --workflow=release.yml --limit 1");
console.log("");
console.log("  It will stop at `Release` and wait for your approval. Approve in");
console.log("  the run page's review prompt, or:");
console.log("");
console.log("    gh run view --web");
console.log("");
