import { constantTimeEquals } from "./constant-time";

/**
 * Is this inbound Telegram update authentic?
 *
 * A pure function rather than an `if` inside the route handler, so both
 * deployment modes can be tested without standing up two servers with
 * different environments. The route is the wiring; this is the decision.
 *
 * @param presented  the `X-Telegram-Bot-Api-Secret-Token` header, or null
 *                   when the caller did not send one
 * @param configured `TELEGRAM_WEBHOOK_SECRET`, or undefined when no
 *                   webhook has been registered for this deployment
 */
export function isAuthorizedTelegramUpdate(
  presented: string | null,
  configured: string | undefined,
): boolean {
  // OUTBOUND-ONLY MODE. No secret configured means no webhook was ever
  // registered, which means no update arriving here can be genuine. The
  // previous version of this check read `if (configured && …)` and so
  // accepted ANY update when the variable was unset — a deployment that
  // forgot one environment variable was an open endpoint that would bind a
  // stranger's alert stream to an attacker's chat. The failure mode of a
  // misconfiguration must be "nothing works", never "everything is
  // permitted".
  if (!configured) return false;

  // `?? ""` and not an early `if (!presented) return false`: an absent
  // header must take the same path, and the same time, as a wrong one.
  return constantTimeEquals(presented ?? "", configured);
}
