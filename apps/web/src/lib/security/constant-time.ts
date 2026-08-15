import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A per-process key for the digest trick below. Random, never persisted,
 * never leaves the process — it exists only so that two values of
 * different lengths can be compared without the comparison telling anyone
 * how long the secret is.
 */
const BLINDING_KEY = randomBytes(32);

/**
 * Constant-time string equality.
 *
 * `a === b` on secrets leaks. JavaScript's string comparison returns at
 * the first differing byte, so the time it takes is a function of how much
 * of the prefix was right — an attacker who can measure it recovers the
 * secret one byte at a time instead of guessing the whole thing.
 * `timingSafeEqual` is the fix, and it is the reason this file exists
 * rather than a `===` with a comment promising to be careful.
 *
 * The awkward part is length. `timingSafeEqual` THROWS when its two
 * buffers differ in size, so calling it directly forces a length check
 * first — and a length check is itself an oracle: it answers "is the
 * secret 32 bytes?" in measurably less time than it answers "is the secret
 * this exact 32-byte string?". So both sides are HMAC'd with a random
 * per-process key first. Digests are always 32 bytes, so the comparison is
 * always the same shape whatever came in, and the blinding key means the
 * digests cannot be precomputed by anyone who has not already got into
 * this process.
 *
 * Deliberately NOT an early return. There is no `if (a.length !== b.length)
 * return false` above, because that line is exactly the leak this is
 * written to avoid.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const digest = (value: string) =>
    createHmac("sha256", BLINDING_KEY).update(value, "utf8").digest();
  return timingSafeEqual(digest(a), digest(b));
}
