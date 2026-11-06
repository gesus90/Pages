import manifest from "@/mcp/package.json";
import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  handleUpdatePicaMobilePort,
  loadPicaMobileView,
} from "@/app/lib/settings-actions/settings-pica-mobile-action.server";
import {
  authorizationFailure,
  authorizationResponse,
  requireAuthorizationOrigin,
} from "@/app/lib/authorization-response.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { User } from "@/definition/User";
import type { ConnectionsData } from "./settings-connections";
import type { Route } from "./+types/settings-connections-server";

async function requireUser(request: Request): Promise<User> {
  const user = await getAuthenticatedUser(request);
  if (!user || user.mustChangePassword)
    throw new McpAuthorizationError("access_denied", 401);
  return user;
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

/** Lists only the requesting owner's safe connection metadata. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  try {
    const user = await requireUser(request);
    const owner = user.id;
    const services = await getApplicationServices();
    const [tokens, validityDays] = await Promise.all([
      services.personalAgentTokenService.list(owner),
      services.pairingService.validity(owner),
    ]);
    const httpOrigin = (await getPagesRuntime()).getConfig().mcpHttp?.publicUrl;
    const picaMobile = await loadPicaMobileView(services, user, request);
    const view: ConnectionsData = {
      ...(httpOrigin ? { httpEndpoint: `${httpOrigin}/mcp` } : {}),
      ...(picaMobile ? { picaMobile } : {}),
      audience: await readLocalStateAudience(services, user),
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

/**
 * Persists owner-scoped preferences, revocation and client-side rotation
 * requests, and, for administrators, the Pica Mobile port.
 */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  try {
    if (request.method !== "POST")
      throw new McpAuthorizationError("invalid_request", 405);
    requireAuthorizationOrigin(request);
    const user = await requireUser(request);
    const owner = user.id;
    const services = await getApplicationServices();
    const form = await request.formData();
    const intent = form.get("intent");
    const id = form.get("id");
    if (intent === "update-pica-mobile-port")
      return await handleUpdatePicaMobilePort(services, user, form);
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
