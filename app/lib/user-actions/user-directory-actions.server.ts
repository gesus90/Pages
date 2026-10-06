import { data } from "react-router";

import { invalidInput, toActionError } from "./user-action-support.server";
import {
  parseCreateUserInput,
  parseUpdateUserInput,
  readUserId,
} from "./user-form.server";

import type {
  UsersActionData,
  UsersActionHandler,
} from "./user-action-support.server";

/** Creates an account; only administrators choose its role. */
export const handleCreateUser: UsersActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const input = parseCreateUserInput(formData);

  if (!input) {
    return invalidInput("create-user");
  }

  try {
    const { temporaryPassword } =
      await services.administrationService.createUser(actor.id, input);
    return data<UsersActionData>(
      { intent: "create-user", ok: true, temporaryPassword },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error: unknown) {
    return toActionError(error, "create-user");
  }
};

/** Activates or deactivates an account. */
export const handleSetActive: UsersActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const userId = formData.get("userId");
  const isActive = formData.get("isActive");

  if (
    typeof userId !== "string" ||
    (isActive !== "true" && isActive !== "false")
  ) {
    return invalidInput("set-active");
  }

  try {
    await services.administrationService.setActive(
      actor.id,
      userId,
      isActive === "true",
    );
  } catch (error: unknown) {
    return toActionError(error, "set-active");
  }

  return data<UsersActionData>({ intent: "set-active", ok: true });
};

/** Changes name, username and email address of an account. */
export const handleUpdateUser: UsersActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const input = parseUpdateUserInput(formData);

  if (!input) {
    return invalidInput("update-user");
  }

  try {
    await services.administrationService.updateProfile(
      actor.id,
      input.userId,
      input,
    );
  } catch (error: unknown) {
    return toActionError(error, "update-user");
  }

  return data<UsersActionData>({ intent: "update-user", ok: true });
};

/** Assigns a role to an account. */
export const handleSetRole: UsersActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const userId = readUserId(formData);
  const role = formData.get("role");

  if (userId === null || typeof role !== "string" || role.trim() === "") {
    return invalidInput("set-role");
  }

  try {
    await services.administrationService.assignRole(actor.id, userId, role);
  } catch (error: unknown) {
    return toActionError(error, "set-role");
  }

  return data<UsersActionData>({ intent: "set-role", ok: true });
};

/**
 * Replaces the password of an account with a temporary one.
 *
 * @remarks
 * The reset replaces a password that may be compromised, so no session
 * opened with the old one may keep working.
 */
export const handleResetPassword: UsersActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const userId = readUserId(formData);

  if (userId === null) {
    return invalidInput("reset-password");
  }

  try {
    const { temporaryPassword } =
      await services.administrationService.resetPassword(actor.id, userId);

    return data<UsersActionData>(
      {
        intent: "reset-password",
        ok: true,
        temporaryPassword,
        userId,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    return toActionError(error, "reset-password");
  }
};
