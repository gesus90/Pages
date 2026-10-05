import { randomUUID } from "node:crypto";

import { data } from "react-router";

import { isRole } from "@/definition/Role";

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
  const input = parseCreateUserInput(formData, actor.role);

  if (!input) {
    return invalidInput("create-user");
  }

  try {
    const passwordHash = await services.passwordHasher.hash(input.password);

    await services.userService.createUser(actor, {
      displayName: input.displayName,
      email: input.email,
      id: randomUUID(),
      passwordHash,
      role: input.role,
      username: input.username,
    });
  } catch (error: unknown) {
    return toActionError(error, "create-user");
  }

  return data<UsersActionData>({ intent: "create-user", ok: true });
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
    await services.userService.setActive(actor, userId, isActive === "true");
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
    await services.userService.updateUser(actor, input.userId, {
      displayName: input.displayName,
      email: input.email,
      username: input.username,
    });
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

  if (userId === null || !isRole(role)) {
    return invalidInput("set-role");
  }

  try {
    await services.userService.setRole(actor, userId, role);
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
    const { temporaryPassword } = await services.userService.resetPassword(
      actor,
      userId,
      services.passwordHasher,
    );

    await services.sessionService.revokeAllSessions(userId);

    return data<UsersActionData>({
      intent: "reset-password",
      ok: true,
      temporaryPassword,
      userId,
    });
  } catch (error: unknown) {
    return toActionError(error, "reset-password");
  }
};
