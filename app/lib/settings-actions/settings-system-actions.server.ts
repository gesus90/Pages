import { data } from "react-router";

import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import {
  ServerSettingsDeniedError,
  ServerSettingsService,
} from "@/backend/service/ServerSettingsService";
import { readText } from "@/app/lib/form-fields.server";

import { forbidden } from "./settings-action-support.server";

import type {
  SettingsActionContext,
  SettingsActionData,
  SettingsActionResult,
} from "./settings-action-support.server";

/**
 * Creates the server settings service for the running instance.
 *
 * @param context - Services of the request.
 * @returns The service bound to the configuration file of this process.
 */
export async function createServerSettingsService(
  context: Pick<SettingsActionContext, "services">,
): Promise<ServerSettingsService> {
  const runtime = await getPagesRuntime();

  return new ServerSettingsService(
    runtime.configFile,
    context.services.permissionService,
  );
}

function readPort(formData: FormData): number {
  const value = (readText(formData, "port") ?? "").trim();

  return /^\d+$/u.test(value) ? Number(value) : Number.NaN;
}

/**
 * Stores the server port an administrator entered.
 *
 * @remarks
 * The port is written to the configuration file and used after the next
 * restart; the running server keeps its port.
 */
export async function handleUpdatePort(
  context: SettingsActionContext,
): Promise<SettingsActionResult> {
  const service = await createServerSettingsService(context);
  const port = readPort(context.formData);

  try {
    if (!(await service.updatePort(context.user, port))) {
      return data<SettingsActionData>(
        { error: "invalidPort", intent: "update-port", ok: false },
        { status: 400 },
      );
    }
  } catch (error: unknown) {
    if (error instanceof ServerSettingsDeniedError) {
      throw forbidden();
    }

    console.error("[pages] The port could not be stored.", error);

    return data<SettingsActionData>(
      { error: "general", intent: "update-port", ok: false },
      { status: 500 },
    );
  }

  return data<SettingsActionData>({ intent: "update-port", ok: true, port });
}
