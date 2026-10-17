import { useLoaderData, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { Plug } from "lucide-react";

import manifest from "@/mcp/package.json";
import { ConnectionsPanel } from "@/app/components/settings/connections/connections-panel";
import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  authorizationFailure,
  authorizationResponse,
  requireAuthorizationOrigin,
} from "@/app/lib/authorization-response.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { logCaughtError } from "@/backend/logging/Logger";

import type { McpConnectionsView } from "@/definition/McpConnections";
import type { ApplicationServices } from "@/app/lib/services.server";
import type { Route } from "./+types/settings-connections";

async function requireOwner(request: Request): Promise<string> {
  const user = await getAuthenticatedUser(request);
  if (!user || user.mustChangePassword)
    throw new McpAuthorizationError("access_denied", 401);
  return user.id;
}

/** Personal connection metadata is never cacheable. */
export function headers(): Headers {
  return new Headers({ "Cache-Control": "no-store", Pragma: "no-cache" });
}

/** Lists only the requesting owner's safe connection metadata. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  try {
    const owner = await requireOwner(request);
    const services = await getApplicationServices();
    const [tokens, validityDays] = await Promise.all([
      services.personalAgentTokenService.list(owner),
      services.pairingService.validity(owner),
    ]);
    const view: McpConnectionsView = {
      origin: new URL(request.url).origin,
      packageVersion: manifest.version,
      tokens,
      validityDays,
    };
    return authorizationResponse(view);
  } catch (error: unknown) {
    logCaughtError("settings_connections", error);

    throw authorizationFailure(error);
  }
}

async function updateToken(
  services: ApplicationServices,
  owner: string,
  id: string,
  intent: string,
): Promise<void> {
  const token = (await services.personalAgentTokenService.list(owner)).find(
    (entry) => entry.id === id && entry.status === "active",
  );
  if (!token) throw new McpAuthorizationError("access_denied", 403);
  if (intent === "revoke-token")
    await services.personalAgentTokenService.revoke(owner, id);
  else await services.personalAgentTokenService.requestRotation(owner, id);
}

/** Persists owner-scoped preferences, revocation and client-side rotation requests. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  try {
    if (request.method !== "POST")
      throw new McpAuthorizationError("invalid_request", 405);
    requireAuthorizationOrigin(request);
    const owner = await requireOwner(request);
    const services = await getApplicationServices();
    const form = await request.formData();
    const intent = form.get("intent");
    const id = form.get("id");
    if (intent === "set-token-duration") {
      const days = form.get("days");
      if (typeof days !== "string" || !/^(0|[1-9]\d{0,2})$/.test(days))
        throw new McpAuthorizationError("invalid_request");
      await services.pairingService.setValidity(owner, Number(days));
    } else if (
      (intent === "revoke-token" || intent === "request-rotation") &&
      typeof id === "string"
    ) {
      await updateToken(services, owner, id, intent);
    } else throw new McpAuthorizationError("invalid_request");
    return authorizationResponse({ updated: true });
  } catch (error: unknown) {
    logCaughtError("settings_connections", error);

    return authorizationFailure(error);
  }
}

/** Renders personal stdio connections and their validity preference. */
export default function SettingsConnectionsRoute(): React.ReactElement {
  return <ConnectionsPanel view={useLoaderData<McpConnectionsView>()} />;
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
