import { data } from "react-router";

import { AUTOMATION_NOTIFICATION_MODES } from "@/definition/Automation";

import { badRequest } from "./settings-action-support.server";

import type {
  SettingsActionContext,
  SettingsActionData,
  SettingsActionResult,
} from "./settings-action-support.server";

/**
 * Stores when the person hears about the runs of the automations they
 * created: off, on errors or always (PAGE-297).
 */
export const handleUpdateAutomationNotification: (
  context: SettingsActionContext,
) => Promise<Exclude<SettingsActionResult, null>> = async ({
  user,
  services,
  formData,
}) => {
  const mode = AUTOMATION_NOTIFICATION_MODES.find(
    (value) => value === formData.get("mode"),
  );
  if (!mode) throw badRequest();
  await services.automationService.setNotificationMode(user.id, mode);
  return data<SettingsActionData>({
    intent: "update-automation-notification",
    ok: true,
    mode,
  });
};
