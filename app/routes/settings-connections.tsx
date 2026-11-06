import { useLoaderData, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { Plug } from "lucide-react";

import { useLocalStateRoute } from "@/app/components/common/use-local-state-route";
import { ConnectionsPanel } from "@/app/components/settings/connections/connections-panel";
import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
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
import type { McpConnectionsView } from "@/definition/McpConnections";
import type { Route } from "./+types/settings-connections";

/** The connection metadata together with the account and rights it was read for. */
export interface ConnectionsData extends McpConnectionsView {
  readonly audience: LocalStateAudience;
}

/** The rights-checked endpoint of the connections area. */
const SETTINGS_CONNECTIONS_ENDPOINT = "/settings-api/connections";

function isConnectionsData(value: unknown): value is ConnectionsData {
  return (
    typeof value === "object" &&
    value !== null &&
    "origin" in value &&
    typeof value.origin === "string" &&
    "packageVersion" in value &&
    typeof value.packageVersion === "string" &&
    "validityDays" in value &&
    typeof value.validityDays === "number" &&
    "tokens" in value &&
    Array.isArray(value.tokens) &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** The connection metadata, kept per account and rights; it never holds a token itself. */
const SETTINGS_CONNECTIONS_STATE: LocalStateRouteKind<ConnectionsData> = {
  schemaVersion: 1,
  isPayload: isConnectionsData,
  isCurrent: (view) => isCurrentLocalStateAudience(view.audience),
  ownerOf: (view) => view.audience.userId,
  isRefused: () => false,
};

/**
 * Opens the connections from the account's kept answer at once and asks the endpoint behind it.
 *
 * @remarks
 * The endpoint runs the server loader; a failed load shows the same notice
 * with its retry as before.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<ConnectionsData>> {
  const url = new URL(request.url);
  return loadLocalFirst(localStateRoute(url), SETTINGS_CONNECTIONS_STATE, () =>
    readRouteData({
      endpoint: `${SETTINGS_CONNECTIONS_ENDPOINT}${url.search}`,
      signal: request.signal,
      isPayload: isConnectionsData,
    }),
  );
}

/** Sends a change of a connection preference to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
}

/** Renders personal stdio connections and their validity preference. */
export default function SettingsConnectionsRoute(): React.ReactElement {
  const view = useLocalStateRoute(
    useLoaderData<typeof clientLoader>(),
    SETTINGS_CONNECTIONS_STATE,
  );
  return <ConnectionsPanel view={view} />;
}

/** Presents a recoverable loading failure using the existing settings card style. */
export function ErrorBoundary(): React.ReactElement {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  return (
    <SettingsCard
      icon={<Plug className="size-4" />}
      title={t("settings.connections.title")}
      description={t("settings.connections.description")}
    >
      <p role="alert" className="pages-selectable text-sm text-destructive">
        {t("settings.connections.error.load")}
      </p>
      <Button
        className="mt-4"
        variant="outline"
        onClick={() => {
          void revalidator.revalidate();
        }}
      >
        {t("settings.connections.error.retry")}
      </Button>
    </SettingsCard>
  );
}
