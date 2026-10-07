import { useLoaderData } from "react-router";

import { AdminModeRequired } from "@/app/components/settings/admin-mode-required";
import { SystemSection } from "@/app/components/settings/system-section";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readSettingsRequest } from "@/app/lib/settings-actions/settings-request.server";
import { resolveSystemSettingsAccess } from "@/app/lib/settings-actions/settings-system-access.server";
import {
  createServerSettingsService,
  handleSystemSettingsAction,
} from "@/app/lib/settings-actions/settings-system-actions.server";

import type { ServerStatus } from "@/backend/service/ServerSettingsService";
import type { InstanceBranding } from "@/definition/Instance";
import type { SettingsActionResult } from "@/app/lib/settings-actions/settings-action-support.server";
import type { Route } from "./+types/settings-system";

type SettingsSystemLoaderData =
  | {
      readonly access: "granted";
      /** Port stored for the next start. */
      readonly port: number;
      readonly branding: InstanceBranding;
      readonly status: ServerStatus;
    }
  | { readonly access: "adminModeRequired" };

/**
 * Loads the system settings for an administrator in the admin mode.
 *
 * @throws A `403` response for accounts without the admin permission.
 */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<SettingsSystemLoaderData> {
  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();

  if ((await resolveSystemSettingsAccess(services, user)) !== "granted") {
    return { access: "adminModeRequired" };
  }

  const serverSettings = await createServerSettingsService({ services });

  const [port, status, branding] = await Promise.all([
    serverSettings.readPort(),
    serverSettings.readStatus(),
    services.instanceSettingsService.getBranding(),
  ]);

  return { access: "granted", branding, port, status };
}

/**
 * Changes the system settings.
 *
 * @remarks
 * Every handler checks the permission itself, so a submission from an account
 * without the admin permission or outside the admin mode is refused there.
 */
export async function action(
  args: Route.ActionArgs,
): Promise<SettingsActionResult> {
  const settingsRequest = await readSettingsRequest(args);

  return handleSystemSettingsAction(
    settingsRequest.formData.get("intent"),
    settingsRequest,
  );
}

/** Renders the system settings, or asks for the admin mode first. */
export default function SettingsSystemRoute(): React.ReactElement {
  const loaderData = useLoaderData<typeof loader>();

  return loaderData.access === "granted" ? (
    <SystemSection
      branding={loaderData.branding}
      port={loaderData.port}
      status={loaderData.status}
    />
  ) : (
    <AdminModeRequired />
  );
}
