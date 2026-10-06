import {
  handleCreateUser,
  handleResetPassword,
  handleSetActive,
  handleSetRole,
  handleUpdateUser,
} from "./user-directory-actions.server";
import { invalidInput } from "./user-action-support.server";
import { ADMINISTRATION_ACTION_HANDLERS } from "./administration-actions.server";

import type {
  UsersActionContext,
  UsersActionHandler,
  UsersActionResult,
} from "./user-action-support.server";

const USERS_ACTION_HANDLERS = {
  ...ADMINISTRATION_ACTION_HANDLERS,
  "create-user": handleCreateUser,
  "reset-password": handleResetPassword,
  "set-active": handleSetActive,
  "set-role": handleSetRole,
  "update-user": handleUpdateUser,
} satisfies Record<string, UsersActionHandler>;

type UsersActionIntent = keyof typeof USERS_ACTION_HANDLERS;

function isUsersActionIntent(value: unknown): value is UsersActionIntent {
  return (
    typeof value === "string" && Object.hasOwn(USERS_ACTION_HANDLERS, value)
  );
}

/**
 * Runs the user directory action a form submission asks for.
 *
 * @param intent - The `intent` field of the submitted form.
 * @param context - Actor, form fields and services of the request.
 * @returns The response for the client; an unknown intent is answered like an
 * invalid create form.
 */
export async function handleUsersAction(
  intent: FormDataEntryValue | null,
  context: UsersActionContext,
): Promise<UsersActionResult> {
  if (!isUsersActionIntent(intent)) {
    return invalidInput("create-user");
  }

  return USERS_ACTION_HANDLERS[intent](context);
}
