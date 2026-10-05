import { useFetcher } from "react-router";

import { readSetupRejection } from "@/app/lib/setup/setup-action-data";

import { useNewActionData } from "./use-new-action-data";

import type {
  CheckedDatabaseLocation,
  SetupActionData,
  SetupRejection,
} from "@/app/lib/setup/setup-action-data";
import type { SetupFieldErrors } from "@/definition/Setup";
import type { SetupDraftValues } from "./use-setup-draft";

/** The state of finishing the setup. */
export interface SetupCompletion {
  readonly finish: (token: string, values: SetupDraftValues) => void;
  readonly isFinishing: boolean;
  /** A failure the wizard shows above its last step. */
  readonly error: "failed" | "network" | null;
  /** The database path the server refused on the last attempt. */
  readonly refusedLocation: CheckedDatabaseLocation | null;
}

/** What the wizard does with a refused completion. */
export interface SetupCompletionHandlers {
  readonly onFieldErrors: (errors: SetupFieldErrors) => void;
  readonly onRejected: (rejection: SetupRejection) => void;
}

/**
 * Submits the whole wizard and reports why a completion was refused.
 *
 * @param handlers - Reactions to field errors and refused requests.
 * @returns How to finish and the state of the last attempt.
 *
 * @remarks
 * A successful completion answers with a redirect into the dashboard,
 * which the router follows; the session cookie comes with it.
 */
export function useSetupCompletion(
  handlers: SetupCompletionHandlers,
): SetupCompletion {
  const { submit, data: actionData, state } = useFetcher<SetupActionData>();

  useNewActionData(actionData, (result) => {
    const rejection = readSetupRejection(result);

    if (rejection !== null) {
      handlers.onRejected(rejection);
    } else if ("fieldErrors" in result) {
      handlers.onFieldErrors(result.fieldErrors);
    }
  });

  function finish(token: string, values: SetupDraftValues): void {
    void submit(
      { ...values, intent: "complete", token },
      { action: "/setup", method: "post" },
    );
  }

  const error =
    actionData !== undefined &&
    "error" in actionData &&
    (actionData.error === "failed" || actionData.error === "network")
      ? actionData.error
      : null;
  const refusedLocation =
    actionData !== undefined &&
    "error" in actionData &&
    actionData.error === "databaseLocation"
      ? actionData.location
      : null;

  return {
    error,
    finish,
    isFinishing: state !== "idle",
    refusedLocation,
  };
}
