import { data } from "react-router";

import { AdministrationError } from "@/backend/error/AdministrationError";
import { logCaughtError } from "@/backend/logging/Logger";

import { badRequest } from "./settings-action-support.server";

import type {
  SettingsActionData,
  SettingsActionContext,
  SettingsActionResult,
} from "./settings-action-support.server";

/** Changes only the caller's persisted mode, without asking for the password again. */
export const handleSetMode: (
  context: SettingsActionContext,
) => Promise<Exclude<SettingsActionResult, null>> = async ({
  user,
  services,
  formData,
}) => {
  const mode = formData.get("mode");
  if (mode !== "admin" && mode !== "role") throw badRequest();
  try {
    await services.administrationService.setMode(user.id, mode);
    return data<SettingsActionData>({ intent: "set-mode", ok: true });
  } catch (error: unknown) {
    logCaughtError("settings_mode_action", error);

    if (!(error instanceof AdministrationError)) throw error;
    return data<SettingsActionData>(
      { intent: "set-mode", ok: false },
      { status: 403 },
    );
  }
};
