/**
 * The intent behind a signed-out click on a tape row.
 *
 * `?pending=watch` in the return URL says an action is owed; it cannot
 * say WHICH row, and putting a ticker in the query string would leave the
 * reader's URL rewritten after a redirect they did not ask for. So the
 * marker travels in the URL (where the auth callback can preserve it) and
 * the payload travels in sessionStorage, which survives the OAuth
 * round-trip, is scoped to the tab, and disappears when it closes.
 *
 * Deliberately single-slot: a queue of replayed actions is a queue of
 * surprises, and only the last thing you clicked is the thing you meant.
 */

const KEY = "if-pending-watch";

export interface PendingWatch {
  refId: string;
  label: string;
  market: string;
  /** True when the click was the bell, not the star. */
  alert?: boolean;
}

export function rememberPendingWatch(intent: PendingWatch): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(intent));
  } catch {
    // Private mode, or storage disabled. The sign-in still works; only
    // the replay is lost, and the reader can click again.
  }
}

/** Reads and clears in one step: a replay must never run twice. */
export function takePendingWatch(): PendingWatch | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as PendingWatch).refId === "string"
    ) {
      return parsed as PendingWatch;
    }
    return null;
  } catch {
    return null;
  }
}
