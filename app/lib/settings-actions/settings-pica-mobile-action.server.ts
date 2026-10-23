import { authorizationResponse } from "@/app/lib/authorization-response.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { obtainPicaMobileGateway } from "@/backend/runtime/PicaMobileRuntime";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import {
  PicaMobileSettingsDeniedError,
  PicaMobileSettingsService,
} from "@/backend/service/mobile/PicaMobileSettingsService";
import { parsePicaMobilePort } from "@/definition/PicaMobile";

import { listsAdminSettings } from "./settings-system-access.server";

import type { ApplicationServices } from "@/app/lib/services.server";
import type {
  PicaMobilePortError,
  PicaMobilePortResult,
  PicaMobileSettingsView,
} from "@/definition/PicaMobile";
import type { User } from "@/definition/User";

const FAILURE_STATUS: Readonly<Record<PicaMobilePortError, number>> = {
  invalidPort: 400,
  portInUse: 409,
  portOfPages: 409,
  permissionDenied: 409,
  listenFailed: 409,
  general: 500,
};

async function createPicaMobileSettingsService(
  services: ApplicationServices,
): Promise<PicaMobileSettingsService> {
  const runtime = await getPagesRuntime();

  return new PicaMobileSettingsService({
    configFile: runtime.configFile,
    permissionService: services.permissionService,
    gateway: obtainPicaMobileGateway(runtime),
  });
}

/**
 * Loads the Pica Mobile settings for the connections page.
 *
 * @param services - Services of the request.
 * @param user - The signed-in user.
 * @param request - The page request; its host tells which address to suggest.
 * @returns The settings for an administrator in the admin mode, otherwise
 * `undefined`, so other accounts never receive them.
 */
export async function loadPicaMobileView(
  services: ApplicationServices,
  user: User,
  request: Request,
): Promise<PicaMobileSettingsView | undefined> {
  const account = await services.administrationService.getContext(user.id);

  if (!listsAdminSettings(account)) {
    return undefined;
  }

  const service = await createPicaMobileSettingsService(services);

  return service.read(user, new URL(request.url).hostname);
}

function respond(result: PicaMobilePortResult): Response {
  return authorizationResponse(
    { picaMobile: result },
    result.ok ? 200 : FAILURE_STATUS[result.error],
  );
}

/**
 * Stores the Pica Mobile port an administrator entered.
 *
 * @param services - Services of the request.
 * @param user - The signed-in user.
 * @param formData - Submitted form with the `port` field.
 * @returns A JSON response with the outcome. A port that is invalid, taken or
 * cannot be bound changes nothing.
 * @throws {McpAuthorizationError} When the user may not change the setting.
 */
export async function handleUpdatePicaMobilePort(
  services: ApplicationServices,
  user: User,
  formData: FormData,
): Promise<Response> {
  const text = formData.get("port");
  const port = typeof text === "string" ? parsePicaMobilePort(text) : null;

  if (port === null) {
    return respond({ ok: false, error: "invalidPort" });
  }

  try {
    const service = await createPicaMobileSettingsService(services);

    return respond(await service.updatePort(user, port));
  } catch (error: unknown) {
    logCaughtError("settings_pica_mobile_action", error);

    if (error instanceof PicaMobileSettingsDeniedError) {
      throw new McpAuthorizationError("access_denied", 403);
    }

    logEvent({
      level: "error",
      event: "pica_mobile.port.save_failed",
      component: "SettingsPicaMobileAction",
      message: "The Pica Mobile port could not be saved",
      error,
    });

    return respond({ ok: false, error: "general" });
  }
}
