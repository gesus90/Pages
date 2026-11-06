import { useEffect, useSyncExternalStore } from "react";

import { localState } from "@/app/lib/local-state/local-state-store";

import type { LocalStateSupersession } from "@/app/lib/local-state/local-state-store";

function subscribe(listener: () => void): () => void {
  return localState.onSuperseded(listener);
}

function readSupersession(): LocalStateSupersession {
  return localState.supersessionState();
}

function readSupersessionOnServer(): LocalStateSupersession {
  return "current";
}

/**
 * Whether another tab of this browser signed out or signed in as another account.
 *
 * @remarks
 * The tab learns it from the other tab's claim of the local state, without
 * asking the server. From that moment it shows nothing of its account,
 * including answers of the earlier session that are still on their way. Once
 * the browser's session settled, with the sign-in page or another account,
 * it loads the page again, so that session decides what the tab shows.
 *
 * @returns `true` once the page's account no longer is the browser's.
 */
export function useSupersededSession(): boolean {
  const supersession = useSyncExternalStore(
    subscribe,
    readSupersession,
    readSupersessionOnServer,
  );
  useEffect(() => {
    if (supersession === "settled") window.location.reload();
  }, [supersession]);
  return supersession !== "current";
}
