import { useState } from "react";
import { useFetcher } from "react-router";

import type { FetcherWithComponents } from "react-router";
import type {
  SetupAccess,
  SetupActionData,
} from "@/app/lib/setup/setup-action-data";

/** Why the token form is shown with a message. */
export type SetupAccessNotice = "invalid" | "expired" | "network";

/** Access to the wizard and the form that grants it. */
export interface SetupAccessState {
  /** Granted access, or `null` while the token form has to be shown. */
  readonly access: SetupAccess | null;
  readonly notice: SetupAccessNotice | null;
  readonly tokenFetcher: FetcherWithComponents<SetupActionData>;
  /** Withdraws access after the server rejected the token. */
  readonly revoke: (token: string) => void;
}

function readFetcherNotice(
  actionData: SetupActionData | undefined,
): SetupAccessNotice | null {
  if (actionData === undefined || !("error" in actionData)) {
    return null;
  }

  return actionData.error === "network" ? "network" : "invalid";
}

/**
 * Keeps track of the setup token the wizard sends with every request.
 *
 * @param initialAccess - Access granted by the token in the setup link.
 * @param hasRejectedToken - Whether the link carried an invalid token.
 *
 * @remarks
 * The token only lives in this component state. A token the server later
 * rejects, for example after a restart, is withdrawn so the form asks for
 * the new one while the entered values stay.
 */
export function useSetupAccess(
  initialAccess: SetupAccess | null,
  hasRejectedToken: boolean,
): SetupAccessState {
  const tokenFetcher = useFetcher<SetupActionData>();
  const [revokedToken, setRevokedToken] = useState<string | null>(null);
  const actionData = tokenFetcher.data;
  const verifiedAccess =
    actionData !== undefined && "access" in actionData
      ? actionData.access
      : null;
  const candidate = verifiedAccess ?? initialAccess;
  const access =
    candidate !== null && candidate.token !== revokedToken ? candidate : null;
  const fallbackNotice = hasRejectedToken ? "invalid" : null;

  return {
    access,
    notice:
      readFetcherNotice(actionData) ??
      (revokedToken === null ? fallbackNotice : "expired"),
    revoke: setRevokedToken,
    tokenFetcher,
  };
}
