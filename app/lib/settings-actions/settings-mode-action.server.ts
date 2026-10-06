import { data } from "react-router";
import { AdministrationError } from "@/backend/error/AdministrationError";
import { badRequest } from "./settings-action-support.server";

import type {
  SettingsActionData,
  SettingsActionHandler,
} from "./settings-action-support.server";

/** Changes only the caller's persisted mode, without asking for the password again. */
export const handleSetMode: SettingsActionHandler = async ({
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
    if (!(error instanceof AdministrationError)) throw error;
    return data<SettingsActionData>(
      { intent: "set-mode", ok: false },
      { status: 403 },
    );
  }
};
