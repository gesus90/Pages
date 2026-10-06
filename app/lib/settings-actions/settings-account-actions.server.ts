import { data } from "react-router";

import { getSessionToken } from "@/app/lib/session.server";
import { MINIMUM_PASSWORD_LENGTH } from "@/definition/User";

import { badRequest } from "./settings-action-support.server";
import { parseSettingsForm } from "./settings-form.server";

import type {
  PasswordChangeOutcome,
  SettingsActionContext,
  SettingsActionData,
  SettingsActionHandler,
} from "./settings-action-support.server";

const MAXIMUM_PASSWORD_LENGTH = 1000;

/** Response shared by voluntary and mandatory password replacement. */
export interface PasswordChangeActionData {
  readonly intent: "change-password";
  readonly outcome: PasswordChangeOutcome;
}

/** Saves the personal preferences; the form reloads without a message. */
export const handleUpdateSettings: SettingsActionHandler = async ({
  user,
  formData,
  services,
}) => {
  const settings = parseSettingsForm(formData);

  if (!settings) {
    throw badRequest();
  }

  await services.settingsService.updateSettings(user.id, settings);

  return null;
};

/** Changes the password of the signed-in user. */
export async function handleChangePassword({
  user,
  request,
  formData,
  services,
}: SettingsActionContext): Promise<
  ReturnType<typeof data<PasswordChangeActionData>>
> {
  const currentPassword = formData.get("currentPassword");
  const newPassword = formData.get("newPassword");
  const passwordConfirmation = formData.get("passwordConfirmation");

  if (
    typeof currentPassword !== "string" ||
    typeof newPassword !== "string" ||
    typeof passwordConfirmation !== "string" ||
    newPassword.length >= MAXIMUM_PASSWORD_LENGTH
  ) {
    return data<PasswordChangeActionData>(
      { intent: "change-password", outcome: "invalidInput" },
      { status: 400 },
    );
  }

  if (newPassword.length < MINIMUM_PASSWORD_LENGTH) {
    return data<PasswordChangeActionData>(
      { intent: "change-password", outcome: "tooShort" },
      { status: 400 },
    );
  }

  if (newPassword !== passwordConfirmation) {
    return data<PasswordChangeActionData>(
      { intent: "change-password", outcome: "mismatch" },
      { status: 400 },
    );
  }

  const outcome = await services.authService.changePassword(
    user.username,
    currentPassword,
    newPassword,
    await getSessionToken(request),
  );

  return data<PasswordChangeActionData>(
    { intent: "change-password", outcome },
    { status: outcome === "success" ? 200 : 400 },
  );
}

/** Signs out one other session of the user. */
export const handleRevokeSession: SettingsActionHandler = async ({
  user,
  request,
  formData,
  services,
}) => {
  const sessionId = formData.get("sessionId");

  if (typeof sessionId !== "string" || sessionId === "") {
    throw badRequest();
  }

  const isRevoked = await services.sessionService.revokeSessionById(
    user.id,
    sessionId,
    await getSessionToken(request),
  );

  if (!isRevoked) {
    throw badRequest();
  }

  return data<SettingsActionData>({ intent: "revoke-session" });
};

/** Signs the user out everywhere except in the requesting browser. */
export const handleRevokeOtherSessions: SettingsActionHandler = async ({
  user,
  request,
  services,
}) => {
  await services.sessionService.revokeOtherSessions(
    user.id,
    await getSessionToken(request),
  );

  return data<SettingsActionData>({ intent: "revoke-other-sessions" });
};
