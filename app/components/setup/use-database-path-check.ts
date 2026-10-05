import { useEffect } from "react";
import { useFetcher } from "react-router";

import { readSetupRejection } from "@/app/lib/setup/setup-action-data";
import { DATABASE_LOCATION_STATUS } from "@/definition/Setup";

import { useNewActionData } from "./use-new-action-data";

import type {
  SetupActionData,
  SetupRejection,
} from "@/app/lib/setup/setup-action-data";
import type { DatabaseLocationStatus } from "@/definition/Setup";

/** Time without typing before the path is checked. */
export const DATABASE_PATH_CHECK_DELAY_MS = 400;

/** The state of the check for the path currently entered. */
export interface DatabasePathCheck {
  /** Result for exactly the current value, or `null` while unknown. */
  readonly status: DatabaseLocationStatus | null;
  readonly isChecking: boolean;
  /** Whether the latest check could not reach the server. */
  readonly hasFailed: boolean;
}

/**
 * Checks the entered database path on the server shortly after typing stops.
 *
 * @param token - Setup token sent with the check.
 * @param databasePath - Path as currently entered.
 * @param onRejected - Receives a refused check, such as an invalid token.
 * @returns The result for the current value.
 *
 * @remarks
 * Each answer names the value it was computed for. An answer for an older
 * value is never shown for the current one, and a newer check replaces a
 * running one.
 */
export function useDatabasePathCheck(
  token: string,
  databasePath: string,
  onRejected: (rejection: SetupRejection) => void,
): DatabasePathCheck {
  const { submit, data: actionData } = useFetcher<SetupActionData>();
  const isEmpty = databasePath.trim() === "";

  useEffect(() => {
    if (isEmpty) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      void submit(
        { databasePath, intent: "check-database-path", token },
        { action: "/setup", method: "post" },
      );
    }, DATABASE_PATH_CHECK_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [databasePath, isEmpty, submit, token]);

  useNewActionData(actionData, (result) => {
    const rejection = readSetupRejection(result);

    if (rejection !== null) {
      onRejected(rejection);
    }
  });

  if (isEmpty) {
    return {
      hasFailed: false,
      isChecking: false,
      status: DATABASE_LOCATION_STATUS.EMPTY,
    };
  }

  const status =
    actionData !== undefined &&
    "location" in actionData &&
    actionData.location.input === databasePath
      ? actionData.location.status
      : null;
  const hasFailed =
    status === null &&
    actionData !== undefined &&
    "error" in actionData &&
    actionData.error === "network";

  return { hasFailed, isChecking: status === null && !hasFailed, status };
}
