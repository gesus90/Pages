import { useLoaderData } from "react-router";

import { useLocalStateRoute } from "@/app/components/common/use-local-state-route";
import { AdminModeRequired } from "@/app/components/settings/admin-mode-required";
import { SystemSection } from "@/app/components/settings/system-section";
import {
  isCurrentLocalStateAudience,
  isLocalStateAudience,
} from "@/app/lib/local-state/local-state-audience";
import {
  loadLocalFirst,
  localStateRoute,
} from "@/app/lib/local-state/local-state-loader";
import { readRouteData } from "@/app/lib/local-state/route-data";
import { sendToBackend } from "@/app/lib/backend-request";

import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type { ServerStatus } from "@/backend/service/ServerSettingsService";
import type { ChatAdministration } from "@/definition/Chat";
import type { LoggingStatus } from "@/definition/Logging";
import type { InstanceBranding } from "@/definition/Instance";
import type { WikiSettings } from "@/definition/Wiki";
import type { Route } from "./+types/settings-system";

/** The system settings as the endpoint answers them, or the request for the admin mode. */
export type SettingsSystemLoaderData =
  | {
      readonly access: "granted";
      /** Port stored for the next start. */
      readonly port: number;
      readonly logging: {
        readonly retentionDays: number;
        readonly status: LoggingStatus;
      };
      readonly branding: InstanceBranding;
      readonly status: ServerStatus;
      readonly wikiSettings: WikiSettings;
      /** Supplementary instruction of the chat agent. */
      readonly chatSettings: ChatAdministration;
      readonly audience: LocalStateAudience;
    }
  | { readonly access: "adminModeRequired" };

/** The rights-checked endpoint of the system settings. */
const SETTINGS_SYSTEM_ENDPOINT = "/settings-api/system";

function isSettingsSystemLoaderData(
  value: unknown,
): value is SettingsSystemLoaderData {
  if (typeof value !== "object" || value === null || !("access" in value))
    return false;
  if (value.access === "adminModeRequired") return true;
  return (
    value.access === "granted" &&
    "status" in value &&
    typeof value.status === "object" &&
    "chatSettings" in value &&
    typeof value.chatSettings === "object" &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/**
 * The system settings, kept per account and rights.
 *
 * @remarks
 * The rights include the admin mode, so leaving it never shows the kept
 * administrator data; the request for the admin mode is not kept.
 */
const SETTINGS_SYSTEM_STATE: LocalStateRouteKind<SettingsSystemLoaderData> = {
  schemaVersion: 1,
  isPayload: isSettingsSystemLoaderData,
  isCurrent: (system) =>
    system.access === "granted" && isCurrentLocalStateAudience(system.audience),
  ownerOf: (system) =>
    system.access === "granted" ? system.audience.userId : "",
  isRefused: (system) => system.access !== "granted",
};

/**
 * Opens the system settings from the account's kept answer at once and asks the endpoint behind it.
 *
 * @remarks
 * The endpoint checks the admin permission and the admin mode again, as the
 * server loader does.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<SettingsSystemLoaderData>> {
  const url = new URL(request.url);
  return loadLocalFirst(localStateRoute(url), SETTINGS_SYSTEM_STATE, () =>
    readRouteData({
      endpoint: `${SETTINGS_SYSTEM_ENDPOINT}${url.search}`,
      signal: request.signal,
      isPayload: isSettingsSystemLoaderData,
    }),
  );
}

/** Sends a change of the system settings to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/** Renders the system settings, or asks for the admin mode first. */
export default function SettingsSystemRoute(): React.ReactElement {
  const loaderData = useLocalStateRoute(
    useLoaderData<typeof clientLoader>(),
    SETTINGS_SYSTEM_STATE,
  );

  return loaderData.access === "granted" ? (
    <SystemSection
      branding={loaderData.branding}
      chatSettings={loaderData.chatSettings}
      logging={loaderData.logging}
      port={loaderData.port}
      status={loaderData.status}
      wikiSettings={loaderData.wikiSettings}
    />
  ) : (
    <AdminModeRequired />
  );
}
