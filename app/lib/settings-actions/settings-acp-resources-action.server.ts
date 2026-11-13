import { data } from "react-router";

import { ServerSettingsDeniedError } from "@/backend/service/ServerSettingsService";
import { logCaughtError } from "@/backend/logging/Logger";
import { parseAcpSessionLimit } from "@/definition/AcpResource";

import { forbidden } from "./settings-action-support.server";
import { AGENT_NO_STORE } from "./settings-agents-response.server";
import { resolveSystemSettingsAccess } from "./settings-system-access.server";

import type {
  AcpLeaseCleanupRequest,
  ServerSettingsService,
} from "@/backend/service/ServerSettingsService";
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

/** At most this many confirmed reservations travel in one cleanup request. */
const MAX_CONFIRMED_LEASES = 1000;
const LEASE_ID = /^[A-Za-z0-9-]{1,100}$/u;

/** The confirmed reservations of a cleanup form, or `null` for an invalid selection. */
function readConfirmedLeases(formData: FormData): readonly string[] | null {
  const values = formData.getAll("instanceId");
  if (values.length > MAX_CONFIRMED_LEASES) return null;
  const ids: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !LEASE_ID.test(value)) return null;
    ids.push(value);
  }
  return ids;
}

/** The request a check form asks for, or `null` when it is invalid. */
function readCleanupRequest(formData: FormData): AcpLeaseCleanupRequest | null {
  const mode = formData.get("mode");
  if (mode === "preview") return { mode };
  if (mode !== "cleanup") return null;
  const instanceIds = readConfirmedLeases(formData);
  return instanceIds === null ? null : { mode, instanceIds };
}

/**
 * Previews or, after confirmation, runs the cleanup of ACP reservations,
 * only for a current system administrator in admin mode (PAGE-340).
 */
export async function handleCheckAcpLeases(
  context: SettingsActionContext,
  service: ServerSettingsService,
): Promise<SettingsActionResult> {
  if (
    (await resolveSystemSettingsAccess(context.services, context.user)) !==
    "granted"
  )
    throw forbidden();
  const request = readCleanupRequest(context.formData);
  if (request === null)
    return data<SettingsActionData>(
      { intent: "check-acp-leases", ok: false, error: "invalidSelection" },
      { status: 400, headers: AGENT_NO_STORE },
    );
  try {
    const report = await service.checkAcpLeases(
      context.user,
      context.services.acpResourceScheduler,
      request,
    );
    return data<SettingsActionData>(
      { intent: "check-acp-leases", ok: true, report },
      { headers: AGENT_NO_STORE },
    );
  } catch (error: unknown) {
    logCaughtError("settings_acp_resources_action", error);
    if (error instanceof ServerSettingsDeniedError) throw forbidden();
    return data<SettingsActionData>(
      { intent: "check-acp-leases", ok: false, error: "general" },
      { status: 500, headers: AGENT_NO_STORE },
    );
  }
}
