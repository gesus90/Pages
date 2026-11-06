import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

import { readSetupRejection } from "@/app/lib/setup/setup-action-data";
import { DATABASE_LOCATION_STATUS } from "@/definition/Setup";

import { useNewActionData } from "./use-new-action-data";

import type {
  SetupActionData,
  SetupRejection,
} from "@/app/lib/setup/setup-action-data";
import type { DatabaseLocationStatus } from "@/definition/Setup";

/** Time without typing before the connection is checked. */
export const DATABASE_URL_CHECK_DELAY_MS = 400;

/** The state of the check for the connection currently entered. */
export interface DatabaseUrlCheck {
  /** Result for exactly the current value, or `null` while unknown. */
  readonly status: DatabaseLocationStatus | null;
  readonly isChecking: boolean;
  /** Whether the latest check could not reach the server. */
  readonly hasFailed: boolean;
}

/**
 * Checks the entered database connection on the server shortly after typing stops.
 *
 * @param token - Setup token sent with the check.
 * @param databaseUrl - Connection as currently entered.
 * @param onRejected - Receives a refused check, such as an invalid token.
 * @returns The result for the current value.
 *
 * @remarks
 * A request identifier matches each answer without returning the URL.
 */
export function useDatabaseUrlCheck(
  token: string,
  databaseUrl: string,
  onRejected: (rejection: SetupRejection) => void,
): DatabaseUrlCheck {
  const { submit, data: actionData } = useFetcher<SetupActionData>();
  const pending = useRef<{ input: string; requestId: string } | null>(null);
  const nextRequest = useRef(0);
  const isEmpty = databaseUrl.trim() === "";

  useEffect(() => {
    if (isEmpty) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      const requestId = String(++nextRequest.current);
      pending.current = { input: databaseUrl, requestId };
      void submit(
        { databaseUrl, requestId, intent: "check-database-connection", token },
        { action: "/setup", method: "post" },
      );
    }, DATABASE_URL_CHECK_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [databaseUrl, isEmpty, submit, token]);

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
    pending.current?.input === databaseUrl &&
    actionData.location.input === pending.current.requestId
      ? actionData.location.status
      : null;
  const hasFailed =
    status === null &&
    actionData !== undefined &&
    "error" in actionData &&
    actionData.error === "network";

  return { hasFailed, isChecking: status === null && !hasFailed, status };
}
