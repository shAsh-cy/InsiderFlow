import { defaultAlertMode } from "@/lib/alerts/policy";

/**
 * "Alert me when this ticker files" — the row-level counterpart to the
 * screener's "save as alert".
 *
 * Same endpoint, same policy for picking instant vs digest, so a rule
 * created from a tape row behaves exactly like one created from a screen
 * and shows up in the same list on the settings page. Returns a boolean
 * rather than throwing: the caller's job is to say whether it worked, not
 * to interpret an HTTP status.
 */
export async function trackTicker(ticker: string): Promise<boolean> {
  const channels = ["telegram"];
  try {
    const response = await fetch("/api/me/alert-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${ticker} — any filing`,
        trackedTicker: ticker,
        mode: defaultAlertMode(channels),
        channels,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
