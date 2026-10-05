import { data } from "react-router";
import {
  EmailTakenError,
  LastAdministratorError,
  RoleAssignmentDeniedError,
  UserManagementDeniedError,
  UserNotFoundError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { User } from "@/definition/User";

/** Why a user directory action failed, as the client shows it. */
export type UsersErrorCode =
  | "usernameTaken"
  | "emailTaken"
  | "invalidInput"
  | "forbidden"
  | "lastAdministrator"
  | "demoteLastAdministrator"
  | "userNotFound";

/** The directory actions a form can ask for. */
export type UsersIntent =
  "create-user" | "set-active" | "update-user" | "set-role" | "reset-password";

/** What the user directory receives after a submitted form. */
export type UsersActionData =
  | {
      readonly ok: true;
      readonly intent: Exclude<UsersIntent, "reset-password">;
    }
  | {
      readonly ok: true;
      readonly intent: "reset-password";
      readonly userId: string;
      readonly temporaryPassword: string;
    }
  | {
      readonly ok: false;
      readonly intent: UsersIntent;
      readonly error: UsersErrorCode;
    };

/** The response a user directory action returns. */
export type UsersActionResult = ReturnType<typeof data<UsersActionData>>;

/** Everything a user directory action handler needs from the request. */
export interface UsersActionContext {
  readonly actor: User;
  readonly formData: FormData;
  readonly services: ApplicationServices;
}

/** Handles one user directory action. */
export type UsersActionHandler = (
  context: UsersActionContext,
) => Promise<UsersActionResult>;

/** Answers a submission whose fields no honest client sends. */
export function invalidInput(intent: UsersIntent): UsersActionResult {
  return data<UsersActionData>(
    { error: "invalidInput", intent, ok: false },
    { status: 400 },
  );
}

/**
 * Turns a failure of a directory action into the response the client shows.
 *
 * @param error - What the service or repository rejected with.
 * @param intent - The action that failed.
 * @returns The response for a known failure.
 * @throws The error itself when it is not a known failure.
 */
export function toActionError(
  error: unknown,
  intent: UsersIntent,
): UsersActionResult {
  if (error instanceof UserNotFoundError) {
    return data<UsersActionData>(
      { error: "userNotFound", intent, ok: false },
      { status: 404 },
    );
  }

  if (error instanceof LastAdministratorError) {
    return data<UsersActionData>(
      {
        error:
          intent === "set-role"
            ? "demoteLastAdministrator"
            : "lastAdministrator",
        intent,
        ok: false,
      },
      { status: 409 },
    );
  }

  if (
    error instanceof RoleAssignmentDeniedError ||
    error instanceof UserManagementDeniedError
  ) {
    return data<UsersActionData>(
      { error: "forbidden", intent, ok: false },
      { status: 403 },
    );
  }

  if (error instanceof UsernameTakenError) {
    return data<UsersActionData>(
      { error: "usernameTaken", intent, ok: false },
      { status: 409 },
    );
  }

  if (error instanceof EmailTakenError) {
    return data<UsersActionData>(
      { error: "emailTaken", intent, ok: false },
      { status: 409 },
    );
  }

  throw error;
}
