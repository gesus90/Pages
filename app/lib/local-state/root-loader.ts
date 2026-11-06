import { isRootData } from "@/app/lib/root-data";

import { isUnreachable } from "./local-state-loader";
import { localState } from "./local-state-store";
import { readRouteData } from "./route-data";

import type { RootData } from "@/app/lib/root-data";
import type { WithLocalState } from "./local-state-loader";
import type { LocalStateKind } from "./local-state-store";

/** The endpoint of the document settings, also the key of their kept answer. */
const ROOT_ENDPOINT = "/app-api/root";

const ROOT_STATE: LocalStateKind<RootData> = {
  schemaVersion: 1,
  isPayload: isRootData,
};

/**
 * Opens the document with the account and settings the browser keeps, when the backend is down.
 *
 * @returns `null` when the browser keeps no account or no settings of it.
 */
async function readKeptRoot(): Promise<WithLocalState<RootData> | null> {
  const owner = await localState.recordedOwner();
  if (owner === null) {
    localState.settleWithoutClaim();
    return null;
  }
  void localState.claim(owner);
  const kept = await localState.read(ROOT_ENDPOINT, ROOT_STATE);
  if (!kept || kept.payload.draftOwnerId !== owner) return null;
  return {
    ...kept.payload,
    localState: { state: "offline", savedAt: kept.savedAt },
  };
}

/**
 * Loads the document settings of the static app and names its account (PAGE-235).
 *
 * @remarks
 * The server's answer claims the browser's local state for the signed-in
 * account before any route reads it, and is kept for that account. When the
 * backend cannot be reached, the document opens with the account the browser
 * last claimed and its kept settings, marked `offline`; the routes then show
 * that account's kept answers. A sign-out empties them (see
 * `LocalStateStore.claim`), so nothing of an account stays after it. Any
 * other failure, such as the redirect to the setup wizard, is passed on.
 *
 * @param signal - Ends the request when the load is cancelled.
 * @returns The settings, from the server or kept.
 */
export async function loadRoot(
  signal: AbortSignal,
): Promise<WithLocalState<RootData>> {
  try {
    const root = await readRouteData({
      endpoint: ROOT_ENDPOINT,
      signal,
      isPayload: isRootData,
    });
    void localState.claim(root.draftOwnerId);
    if (root.draftOwnerId !== null)
      void localState.save(root.draftOwnerId, ROOT_ENDPOINT, ROOT_STATE, root);
    return root;
  } catch (error: unknown) {
    const kept = isUnreachable(error) ? await readKeptRoot() : null;
    // Routes wait for the claim; a document without account must not hold them.
    localState.settleWithoutClaim();
    if (kept) return kept;
    throw error;
  }
}
