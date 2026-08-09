import pkg from "../../package.json";

/**
 * What this build actually is.
 *
 * The version is read from package.json rather than restated here, because
 * a version string kept in two places is a version string that is wrong in
 * one of them.
 *
 * The commit is whatever the CI that built this exposed, and `null` when
 * nothing did. A footer that prints "dev" or a zeroed SHA on a deployed
 * site is the same class of mistake as a fabricated zero in a filing: it
 * looks like a fact and is not one. Nothing is shown when nothing is known.
 *
 * Server-only by construction — these are build-time variables without the
 * NEXT_PUBLIC_ prefix, so they are inlined for the server and absent on the
 * client. The footer that renders them is a server component.
 */
export const BUILD = {
  version: pkg.version as string,
  commit:
    process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.BUILD_SHA ?? null,
} as const;

/** `v0.1.0` alone, or `v0.1.0 · 8136561` where a commit is known. */
export function buildString(): string {
  const short = BUILD.commit ? BUILD.commit.slice(0, 7) : null;
  return short ? `v${BUILD.version} · ${short}` : `v${BUILD.version}`;
}
