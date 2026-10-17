import { data } from "react-router";

import { ServerSettingsDeniedError } from "@/backend/service/ServerSettingsService";
import { logCaughtError } from "@/backend/logging/Logger";
import { parseAcpSessionLimit } from "@/definition/AcpResource";

import { forbidden } from "./settings-action-support.server";
import { AGENT_NO_STORE } from "./settings-agents-response.server";
import { resolveSystemSettingsAccess } from "./settings-system-access.server";

import type { ServerSettingsService } from "@/backend/service/ServerSettingsService";
import type {
  SettingsActionContext,
  SettingsActionData,
  SettingsActionResult,
} from "./settings-action-support.server";

/** Applies instance-wide ACP limits only for a current system administrator in admin mode. */
export async function handleUpdateAcpResources(
  context: SettingsActionContext,
  service: ServerSettingsService,
): Promise<SettingsActionResult> {
  if (
    (await resolveSystemSettingsAccess(context.services, context.user)) !==
    "granted"
  )
    throw forbidden();
  const candidates = context.formData.getAll("maxConcurrentAcpSessions");
  const limit =
    candidates.length === 1 ? parseAcpSessionLimit(candidates[0]) : null;
  try {
    const result = await service.updateAcpResources(
      context.user,
      limit ?? Number.NaN,
      context.services.acpResourceScheduler,
    );
    let status = 200;
    if (!result.ok) status = result.error === "environmentOverride" ? 409 : 400;
    return data<SettingsActionData>(
      { intent: "update-acp-resources", ...result },
      { status, headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    logCaughtError("settings_acp_resources_action", error);
    if (error instanceof ServerSettingsDeniedError) throw forbidden();
    return data<SettingsActionData>(
      { intent: "update-acp-resources", ok: false, error: "general" },
      { status: 500, headers: AGENT_NO_STORE },
    );
  }
}
