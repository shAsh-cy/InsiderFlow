import type { SessionInfo } from "@/components/shell/session-provider";

/**
 * What the masthead should draw for the current session.
 *
 * Extracted so the decision can be tested without a browser or a real
 * Supabase project. The signed-in branch is otherwise unreachable in the
 * e2e suite — minting a valid session cookie would mean either shipping a
 * test-only server bypass or holding real credentials in CI, and neither
 * belongs in an application about to enter a security review.
 *
 * The three states are not symmetric, and the asymmetry is the point:
 *
 *   "none"     — auth is not configured on this deployment at all. The bar
 *                advertises nothing, because an affordance that cannot
 *                work is worse than a missing one.
 *   "sign-in"  — configured, nobody signed in. A plain link to /login: no
 *                overlay, no menu, and therefore no reason for a
 *                signed-out reader to download either.
 *   "account"  — a resolved user. Only ever reached from a session the
 *                SERVER verified; a present-but-invalid or expired cookie
 *                leaves `userId` null and lands in "sign-in", which is the
 *                case that actually matters.
 */
export type AccountState = "none" | "sign-in" | "account";

export function accountState(session: SessionInfo | undefined): AccountState {
  if (!session?.authConfigured) return "none";
  return session.userId ? "account" : "sign-in";
}
