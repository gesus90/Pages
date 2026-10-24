import { data } from "react-router";

import { isTerminalScreenReaderMode } from "@/definition/Settings";

import { badRequest } from "./settings-action-support.server";

import type {
  SettingsActionData,
  SettingsActionHandler,
} from "./settings-action-support.server";

/**
 * Stores the remote console's screen reader mode of the signed-in user.
 *
 * @remarks
 * The account comes from the session; the form carries only the mode.
 */
export const handleUpdateTerminalScreenReader: SettingsActionHandler = async ({
  user,
  formData,
  services,
}) => {
  const mode = formData.get("terminalScreenReader");

  if (!isTerminalScreenReaderMode(mode)) {
    throw badRequest();
  }

  await services.settingsService.updateTerminalScreenReader(user.id, mode);

  return data<SettingsActionData>({
    intent: "update-terminal-screen-reader",
    ok: true,
  });
};
