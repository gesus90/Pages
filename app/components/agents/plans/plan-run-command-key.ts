import { createRandomUuid } from "@/app/lib/random-uuid";

const pending = new Map<string, string>();
const PREFIX = "pages-plan-command:";

/** Reuses an unanswered command across clicks, connection loss and a tab reload. */
export function planRunCommandKey(identity: string): string {
  const known = pending.get(identity);
  if (known) return known;
  let key: string | null = null;
  try {
    key = window.sessionStorage.getItem(PREFIX + identity);
  } catch {
    // Private browsing can deny storage; the in-memory identity still covers retries.
  }
  key ??= `ui-${createRandomUuid()}`;
  pending.set(identity, key);
  try {
    window.sessionStorage.setItem(PREFIX + identity, key);
  } catch {
    // Keep the in-memory identity when browser persistence is unavailable.
  }
  return key;
}

/** A confirmed answer completes only the command with that exact key. */
export function completePlanRunCommand(key: string): void {
  for (const [identity, candidate] of pending) {
    if (candidate !== key) continue;
    pending.delete(identity);
    try {
      window.sessionStorage.removeItem(PREFIX + identity);
    } catch {
      // The in-memory identity was completed even when storage is unavailable.
    }
  }
}
