import {
  handleChangePassword,
  handleRevokeOtherSessions,
  handleRevokeSession,
  handleUpdateSettings,
} from "./settings-account-actions.server";
import { runSettingsAction } from "./settings-action-support.server";
import { handleSetMode } from "./settings-mode-action.server";
import {
  handleUpdateAvatar,
  handleUpdateProfile,
} from "./settings-profile-actions.server";

import type {
  SettingsActionContext,
  SettingsActionHandler,
  SettingsActionResult,
} from "./settings-action-support.server";

const SETTINGS_ACTION_HANDLERS = {
  "set-mode": handleSetMode,
  "change-password": handleChangePassword,
  "revoke-other-sessions": handleRevokeOtherSessions,
  "revoke-session": handleRevokeSession,
  "update-avatar": handleUpdateAvatar,
  "update-profile": handleUpdateProfile,
  "update-settings": handleUpdateSettings,
} satisfies Record<string, SettingsActionHandler>;

/**
 * Runs the personal settings action a form submission asks for.
 *
 * @param intent - The `intent` field of the submitted form.
 * @param context - User, request, form fields and services of the request.
 * @returns The response for the client.
 * @throws A `400` response for an unknown intent, plus whatever the handler
 * rejects with.
 */
export async function handleSettingsAction(
  intent: FormDataEntryValue | null,
  context: SettingsActionContext,
): Promise<SettingsActionResult> {
  return runSettingsAction(SETTINGS_ACTION_HANDLERS, intent, context);
}
