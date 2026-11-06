import { isShellData } from "@/app/lib/shell-data";

import {
  rememberLocalStateAudience,
  settleWithoutLocalStateAudience,
} from "./local-state-audience";
import { loadServerFirst } from "./local-state-loader";
import { localState } from "./local-state-store";
import { readRouteData } from "./route-data";

import type { ShellData } from "@/app/lib/shell-data";
import type { WithLocalState } from "./local-state-loader";
import type { LocalStateKind } from "./local-state-store";

/** The endpoint of the workspace frame, also the key of its kept answer. */
const SHELL_ENDPOINT = "/app-api/shell";

const SHELL_STATE: LocalStateKind<ShellData> = {
  schemaVersion: 1,
  isPayload: isShellData,
  isCurrent: (shell) => shell.user.id === localState.currentOwner(),
};

/**
 * Loads the workspace frame of the static app (PAGE-235).
 *
 * @remarks
 * Always asks the server first: the frame names the account and its rights.
 * The answer is kept for the account, so the frame opens from it, marked
 * `offline`, when the backend cannot be reached. A redirect, such as to the
 * sign-in page after the session ended, is passed on. The frame's account
 * and fingerprint are remembered before any route of the frame decides
 * whether its kept answer still applies.
 *
 * @param signal - Ends the request when the load is cancelled.
 * @returns The frame, from the server or kept.
 */
export async function loadShell(
  signal: AbortSignal,
): Promise<WithLocalState<ShellData>> {
  try {
    const shell = await loadServerFirst(
      SHELL_ENDPOINT,
      SHELL_STATE,
      async () => {
        const answer = await readRouteData({
          endpoint: SHELL_ENDPOINT,
          signal,
          isPayload: isShellData,
        });
        void localState.save(
          answer.user.id,
          SHELL_ENDPOINT,
          SHELL_STATE,
          answer,
        );
        return answer;
      },
    );
    rememberLocalStateAudience({
      userId: shell.user.id,
      authorizationVersion: shell.authorizationVersion,
    });
    return shell;
  } finally {
    settleWithoutLocalStateAudience();
  }
}
