/**
 * Delivery-mode policy for newly created rules.
 *
 * Batching exists to protect the Resend free tier (100 emails/day), not
 * because instant delivery is expensive — Telegram is free and unlimited.
 * So the digest is the default only when email is actually in play; a
 * Telegram-only rule has nothing to conserve and should fire immediately.
 *
 * Kept dependency-free so the client bundle can import it without pulling in
 * the db/core packages.
 */
export type AlertMode = "instant" | "digest";

/** Channels whose provider caps volume, so their alerts batch into a digest. */
const METERED_CHANNELS = new Set(["email"]);

export function defaultAlertMode(channels: readonly string[]): AlertMode {
  return channels.some((c) => METERED_CHANNELS.has(c)) ? "digest" : "instant";
}
