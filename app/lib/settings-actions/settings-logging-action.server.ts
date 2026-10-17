import { data } from "react-router";

import { ServerSettingsDeniedError } from "@/backend/service/ServerSettingsService";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import { forbidden } from "./settings-action-support.server";
import { resolveSystemSettingsAccess } from "./settings-system-access.server";

import type { ServerSettingsService } from "@/backend/service/ServerSettingsService";
import type {
  SettingsActionContext,
  SettingsActionData,
  SettingsActionResult,
} from "./settings-action-support.server";

/** Validates integer text and applies the instance retention only for system administrators. */
export async function handleUpdateLogging(
  context: SettingsActionContext,
  service: ServerSettingsService,
): Promise<SettingsActionResult> {
  if (
    (await resolveSystemSettingsAccess(context.services, context.user)) !==
    "granted"
  )
    throw forbidden();
  const candidate = context.formData.get("logRetentionDays");
  const days =
    typeof candidate === "string" && /^\d+$/u.test(candidate.trim())
      ? Number(candidate.trim())
      : Number.NaN;
  try {
    if (!(await service.updateLogging(context.user, days))) {
      return data<SettingsActionData>(
        { intent: "update-logging", ok: false, error: "invalidSetting" },
        { status: 400 },
      );
    }
    return data<SettingsActionData>({
      intent: "update-logging",
      ok: true,
      retentionDays: days,
    });
  } catch (error: unknown) {
    logCaughtError("settings_logging_action", error);

    if (error instanceof ServerSettingsDeniedError) throw forbidden();
    logEvent({
      level: "error",
      event: "logging.retention.save_failed",
      component: "SettingsLoggingAction",
      message: "Log retention could not be saved",
      error,
    });
    return data<SettingsActionData>(
      { intent: "update-logging", ok: false, error: "general" },
      { status: 500 },
    );
  }
}
