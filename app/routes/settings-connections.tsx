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
  oauthFailure,
  oauthResponse,
  requireOAuthOrigin,
} from "@/app/lib/oauth-response.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type { McpConnectionsView } from "@/definition/McpConnections";
import type { ApplicationServices } from "@/app/lib/services.server";
import type { Route } from "./+types/settings-connections";

async function requireOwner(request: Request): Promise<string> {
  const user = await getAuthenticatedUser(request);
  if (!user || user.mustChangePassword)
    throw new McpAuthorizationError("access_denied", 401);
  return user.id;
}

/** Personal credential and OAuth metadata are never cacheable. */
export function headers(): Headers {
  return new Headers({ "Cache-Control": "no-store", Pragma: "no-cache" });
}

/** Lists only the requesting owner's safe connection metadata. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  try {
    const owner = await requireOwner(request);
    const services = await getApplicationServices();
    const [tokens, validityDays, oauth] = await Promise.all([
      services.personalAgentTokenService.list(owner),
      services.pairingService.validity(owner),
      services.oauthGrantService.connections(owner),
    ]);
    const view: McpConnectionsView = {
      origin: new URL(request.url).origin,
      packageVersion: manifest.version,
      tokens,
      validityDays,
      oauth: {
        durationSeconds: oauth.durationSeconds,
        grants: oauth.grants.map(
          ({ id, clientName, verifiedAt, expiresAt, status }) => ({
            id,
            clientName,
            verifiedAt,
            expiresAt,
            status,
          }),
        ),
      },
    };
    return oauthResponse(view);
  } catch (error: unknown) {
    throw oauthFailure(error);
  }
}

async function updateOAuthDuration(
  services: ApplicationServices,
  owner: string,
  form: FormData,
): Promise<Response> {
  const input = form.get("duration");
  const duration = input === "unlimited" ? null : Number(input);
  if (
    typeof input !== "string" ||
    (duration !== null &&
      (!/^\d+$/.test(input) ||
        !Number.isSafeInteger(duration) ||
        duration < 1 ||
        duration > 315_576_000))
  )
    throw new McpAuthorizationError("invalid_request");
  const current = await services.oauthGrantService.get(owner);
  const ending = current.grants.filter(
    (grant) =>
      grant.status === "active" &&
      duration !== null &&
      grant.verifiedAt + duration * 1000 <= Date.now(),
  ).length;
  if (ending > 0 && form.get("confirmShorten") !== "on")
    return oauthResponse(
      { error: "confirmation_required", count: ending },
      409,
    );
  await services.oauthGrantService.setDuration(owner, duration);
  return oauthResponse({ updated: true });
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
    requireOAuthOrigin(request);
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
    } else if (intent === "set-oauth-duration") {
      return await updateOAuthDuration(services, owner, form);
    } else if (intent === "revoke-oauth-grant" && typeof id === "string") {
      await services.oauthGrantService.revoke(owner, id);
    } else if (
      (intent === "revoke-token" || intent === "request-rotation") &&
      typeof id === "string"
    ) {
      await updateToken(services, owner, id, intent);
    } else throw new McpAuthorizationError("invalid_request");
    return oauthResponse({ updated: true });
  } catch (error: unknown) {
    return oauthFailure(error);
  }
}

/** Renders personal stdio connections and the existing HTTP OAuth preferences. */
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
