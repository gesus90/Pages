import type {
  DatabaseLocationStatus,
  SetupFieldErrors,
} from "@/definition/Setup";

/** Requests the setup wizard sends to its route action. */
export type SetupIntent = "verify-token" | "check-database-path" | "complete";

/** Access to the wizard after the setup token was accepted. */
export interface SetupAccess {
  readonly token: string;
  readonly suggestedDatabasePath: string;
}

/** The result of a database path check for exactly one entered value. */
export interface CheckedDatabaseLocation {
  /** The value the check ran for, as entered. */
  readonly input: string;
  readonly status: DatabaseLocationStatus;
}

/** Why a setup request did not succeed, apart from field errors. */
export type SetupRequestError =
  "invalidToken" | "alreadyCompleted" | "network" | "failed";

/** A refusal after which the wizard cannot continue as it is. */
export type SetupRejection = Extract<
  SetupRequestError,
  "invalidToken" | "alreadyCompleted"
>;

/**
 * Tells whether an answer refuses the wizard as a whole.
 *
 * @param actionData - Answer of the setup action.
 * @returns The refusal, or `null` for every other answer.
 */
export function readSetupRejection(
  actionData: SetupActionData,
): SetupRejection | null {
  if (
    "error" in actionData &&
    (actionData.error === "invalidToken" ||
      actionData.error === "alreadyCompleted")
  ) {
    return actionData.error;
  }

  return null;
}

/** What the setup route action answers. */
export type SetupActionData =
  | { readonly intent: "verify-token"; readonly access: SetupAccess }
  | {
      readonly intent: "check-database-path";
      readonly location: CheckedDatabaseLocation;
    }
  | { readonly intent: SetupIntent; readonly error: SetupRequestError }
  | {
      readonly intent: "complete";
      readonly error: "invalidInput";
      readonly fieldErrors: SetupFieldErrors;
    }
  | {
      readonly intent: "complete";
      readonly error: "databaseLocation";
      readonly location: CheckedDatabaseLocation;
    };

/** What the setup route loader provides. */
export type SetupLoaderData =
  | { readonly status: "completed" }
  | {
      readonly status: "pending";
      /** Access granted by a valid token in the link, otherwise `null`. */
      readonly access: SetupAccess | null;
      /** Whether the link carried a token that is not valid. */
      readonly hasRejectedToken: boolean;
    };

/** Form field names shared by the wizard and the route action. */
export const SETUP_FORM_FIELD = {
  INTENT: "intent",
  TOKEN: "token",
  COMPANY_NAME: "companyName",
  USERNAME: "username",
  PASSWORD: "password",
  EMAIL: "email",
  DATABASE_PATH: "databasePath",
} as const;
