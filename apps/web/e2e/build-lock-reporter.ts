import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { FullConfig, FullResult, Reporter, TestCase } from "@playwright/test/reporter";

/**
 * A LOCK ON THE BUILD, HELD FOR THE WHOLE RUN.
 *
 * ── THE INCIDENT ──────────────────────────────────────────────────────
 *
 * `global-setup.ts` already proves, before the first test, that the server
 * about to be tested is serving THIS working tree's build. That check is
 * necessary and it is not sufficient, because it happens once.
 *
 * During r16 the e2e suite reported 4 failures. They were false. What had
 * happened is that a `pnpm build` was started in another terminal while the
 * suite was running: `next build` and `next start` share the same `.next`
 * directory, so the build rewrote the artefact under the live server, and
 * the tests that were in flight asked for chunks that had just stopped
 * existing. The failures arrived as ordinary assertion and timeout errors
 * in four unrelated specs, which is indistinguishable from a real
 * regression in whatever was changed last. It cost an isolated re-run and
 * a full re-run to establish that nothing was wrong with the product.
 *
 * That is the same shape as the r15 incident that produced `global-setup`'s
 * check — a harness lying about which component failed — and the same
 * shape as the r11 incident in `playwright.config.ts`, where a dev server
 * rewrote `.next` under a production one and fifteen tests blamed a font.
 * Three times now, the answer has been that the build moved.
 *
 * ── WHY A REPORTER ────────────────────────────────────────────────────
 *
 * The check has to run repeatedly, during the run, and it must not require
 * editing specs. All 35 spec files import `test` straight from
 * `@playwright/test`, so an auto-use fixture would mean rewriting every one
 * of their imports — a large diff across exactly the files this project is
 * most careful about, to install a guard that has nothing to do with what
 * any of them assert.
 *
 * A reporter needs none of that. It runs in the main process, it is handed
 * every test boundary as it happens, and `onEnd` may return a status, so it
 * can fail a run that would otherwise be green.
 *
 * ── WHY `.next/BUILD_ID` AND NOT THE SERVER ───────────────────────────
 *
 * The obvious check is the one `global-setup` makes: fetch the running
 * server's build manifest. Done per test that is 355 extra HTTP requests,
 * and — more to the point — it is the LATE signal. `next build` writes into
 * `.next` for a minute or more before anything about the server's responses
 * changes. Watching the file on disk catches the rebuild WHILE IT IS
 * HAPPENING, which is the difference between naming the cause and watching
 * the symptoms arrive.
 *
 * So the id is read once at `onBegin` and re-read at every test boundary,
 * which is two `stat`-class syscalls per test and immeasurable next to
 * driving a browser. Two states count as a breach:
 *
 *   - the id CHANGED — a rebuild finished under the run;
 *   - the id is GONE — a rebuild is in progress right now.
 *
 * The second is the early one and the reason this is worth doing at all.
 *
 * ── WHAT IT DOES WHEN IT FIRES ────────────────────────────────────────
 *
 * Says so immediately, on stderr, naming the test boundary it was noticed
 * at; asks the run to stop; and fails the run at `onEnd` whatever the tests
 * themselves reported. The last part is the one that matters: results
 * produced after the build moved are not evidence in either direction, and
 * a green run under those conditions is a worse outcome than a red one.
 */

/** What `.next/BUILD_ID` says right now, or that it cannot be read. */
type Probe = { state: "present"; id: string } | { state: "absent" };

function probeBuild(rootDir: string): Probe {
  try {
    const id = readFileSync(join(rootDir, ".next", "BUILD_ID"), "utf8").trim();
    // A zero-length read is `next build` mid-write, not a valid build.
    return id ? { state: "present", id } : { state: "absent" };
  } catch {
    return { state: "absent" };
  }
}

interface Breach {
  what: string;
  detail: string;
  noticedAt: string;
  completedBefore: number;
}

export default class BuildLockReporter implements Reporter {
  private rootDir = process.cwd();
  private lockedId: string | null = null;
  /** Set when the guard has nothing to watch; explained once, then silent. */
  private inertReason: string | null = null;
  private breach: Breach | null = null;
  private completed = 0;
  private completedAfterBreach = 0;
  private stopRequested = false;

  onBegin(config: FullConfig): void {
    // `configFile`, NOT `rootDir`. This is the bug the first version of this
    // file shipped with, and it is worth the sentence: `FullConfig.rootDir`
    // is "the base directory for relative paths used in the reporters",
    // which Playwright derives from `testDir` — here `apps/web/e2e`. So the
    // guard looked for `apps/web/e2e/.next/BUILD_ID`, never found it, went
    // inert, printed one line saying so, and let a green run through.
    //
    // A guard that measures nothing and reports success is the precise
    // failure this project keeps finding, and it found this one only because
    // the inert branch says WHY out loud. Both halves of that lesson are
    // kept: the path is resolved against the config file's own directory,
    // and being unable to take the lock is now a failure rather than a shrug.
    this.rootDir = config.configFile ? dirname(config.configFile) : process.cwd();

    if (process.env.PLAYWRIGHT_BASE_URL) {
      // The one legitimate reason to hold no lock: the operator pointed the
      // suite at a target they chose, and there is no local build for it to
      // be the same as. `global-setup` declines to second-guess that choice
      // for the same reason and in the same words.
      this.inertReason = `PLAYWRIGHT_BASE_URL is set (${process.env.PLAYWRIGHT_BASE_URL})`;
      this.say(`build lock NOT held — ${this.inertReason}`);
      return;
    }

    const start = probeBuild(this.rootDir);
    if (start.state === "absent") {
      // There is no benign version of this. Without PLAYWRIGHT_BASE_URL the
      // config manages its own server with `next build && next start`, and
      // that plugin runs before this reporter is called — so `.next/BUILD_ID`
      // exists by now in every path that is working correctly.
      this.raise(
        "the build lock could not be taken",
        `${join(this.rootDir, ".next", "BUILD_ID")} is not readable, and PLAYWRIGHT_BASE_URL is ` +
          "not set, so this run has no build identity to hold for the duration.",
        "before the first test",
      );
      return;
    }

    this.lockedId = start.id;
    this.say(`build lock held — ${this.lockedId}`);
  }

  /**
   * stderr, NOT stdout.
   *
   * The JSON and JUnit reporters write their document to stdout, and
   * anything else printed there lands inside it: one stdout line from
   * `global-setup` turned `--reporter=json` into "Unexpected token 'e'".
   */
  private say(line: string): void {
    process.stderr.write(`${line}\n`);
  }

  onTestBegin(test: TestCase): void {
    this.inspect(`starting ${title(test)}`);
  }

  onTestEnd(test: TestCase): void {
    this.completed += 1;
    if (this.breach) this.completedAfterBreach += 1;
    this.inspect(`after ${title(test)}`);
  }

  private inspect(where: string): void {
    // One breach is the whole story; re-reporting it every test would bury
    // the moment it was first seen under three hundred copies of itself.
    if (this.inertReason !== null || this.breach !== null || this.lockedId === null) return;

    const now = probeBuild(this.rootDir);
    if (now.state === "absent") {
      this.raise(
        "a rebuild is in progress underneath this run",
        `.next/BUILD_ID was ${this.lockedId} when the run started and is not readable now. ` +
          "`next build` and `next start` share the same .next directory, so the artefact " +
          "this suite is testing is being overwritten as it runs.",
        where,
      );
      return;
    }
    if (now.id !== this.lockedId) {
      this.raise(
        "the build changed underneath this run",
        `.next/BUILD_ID was ${this.lockedId} when the run started and is ${now.id} now. ` +
          "Something rebuilt the app while the suite was testing it.",
        where,
      );
    }
  }

  private raise(what: string, detail: string, where: string): void {
    this.breach = { what, detail, noticedAt: where, completedBefore: this.completed };
    process.stderr.write(
      [
        "",
        `E2E BUILD LOCK BROKEN — ${what}`,
        "",
        `  ${detail}`,
        "",
        `  Noticed: ${where}`,
        `  ${this.completed} test(s) had completed before this point.`,
        "",
        "  Stopping. Results from here on are not evidence in either direction.",
        "",
      ].join("\n"),
    );
    this.requestStop();
  }

  /**
   * Best effort, and deliberately not load-bearing.
   *
   * Playwright installs a SIGINT handler that stops a run gracefully —
   * closing browsers and shutting down the managed web server rather than
   * orphaning them, which on Windows is the difference between a clean tree
   * and a port nobody can bind tomorrow. `process.emit` invokes those
   * listeners directly; it is not a real signal, so it does nothing at all
   * if the handler is not installed. That is the acceptable failure mode:
   * `onEnd` fails the run regardless, so this only ever changes how SOON the
   * run stops, never whether it is reported.
   */
  private requestStop(): void {
    if (this.stopRequested) return;
    this.stopRequested = true;
    try {
      process.emit("SIGINT");
    } catch {
      /* the guard's verdict does not depend on this working */
    }
  }

  // `async` because the interface types the return as a Promise: Playwright
  // awaits it before deciding the exit code, which is what lets a reporter
  // overrule the run's own verdict.
  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] } | void> {
    if (this.breach === null) return;

    process.stderr.write(
      [
        "",
        `FAIL — ${this.breach.what}.`,
        "",
        `  ${this.breach.detail}`,
        "",
        `  First noticed: ${this.breach.noticedAt}`,
        `  Completed before it was noticed: ${this.breach.completedBefore}`,
        `  Completed after:                 ${this.completedAfterBreach}`,
        `  Playwright's own verdict on the tests was: ${result.status}`,
        "",
        "  That verdict is being overridden to `failed`, because it was measured",
        "  against an artefact that was changing. Passes are as meaningless as the",
        "  failures — r16 spent two re-runs proving four such failures were false.",
        "",
        "  Fix: do not build while the suite runs. Re-run the suite on a settled",
        "  tree — `pnpm test:e2e` builds and starts its own server.",
        "",
      ].join("\n"),
    );

    // Overrides a green run. See the class comment: this is the point.
    return { status: "failed" };
  }
}

/** `file › describe › test`, trimmed to something readable in one line. */
function title(test: TestCase): string {
  const path = test.titlePath().filter(Boolean).slice(2).join(" › ");
  return path.length > 90 ? `${path.slice(0, 87)}...` : path;
}
