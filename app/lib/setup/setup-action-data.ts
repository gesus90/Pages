import type {
  DatabaseLocationStatus,
  SetupFieldErrors,
} from "@/definition/Setup";

/** Requests the setup wizard sends to its route action. */
export type SetupIntent =
  "verify-token" | "check-database-connection" | "complete";

/** Access to the wizard after the setup token was accepted. */
export interface SetupAccess {
  readonly token: string;
  readonly suggestedDatabaseUrl: string;
}

/** The result of a connection check, paired with its request identifier. */
export interface CheckedDatabaseLocation {
  /** Opaque request identifier; never the connection URL. */
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
      readonly intent: "check-database-connection";
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
  DATABASE_URL: "databaseUrl",
} as const;

/**
 * Whether an answer of the API has the shape of {@link SetupLoaderData}.
 *
 * @param value - The answer of `/app-api/setup`.
 */
export function isSetupLoaderData(value: unknown): value is SetupLoaderData {
  if (typeof value !== "object" || value === null || !("status" in value))
    return false;
  if (value.status === "completed") return true;
  return (
    value.status === "pending" &&
    "access" in value &&
    "hasRejectedToken" in value &&
    typeof value.hasRejectedToken === "boolean"
  );
}

/**
 * Whether an answer of the API has the shape of {@link SetupActionData}.
 *
 * @param value - The answer of the setup action.
 */
export function isSetupActionData(value: unknown): value is SetupActionData {
  return (
    typeof value === "object" &&
    value !== null &&
    "intent" in value &&
    (value.intent === "verify-token" ||
      value.intent === "check-database-connection" ||
      value.intent === "complete")
  );
}
