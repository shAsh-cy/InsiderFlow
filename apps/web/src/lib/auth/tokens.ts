import { randomBytes } from "node:crypto";

/** URL-safe random token for Telegram link + email unsubscribe. */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
