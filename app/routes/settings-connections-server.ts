import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { handleRevokeMcpDevice } from "@/app/lib/settings-actions/settings-mcp-device-action.server";
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
import { logCaughtError } from "@/backend/logging/Logger";

import type { User } from "@/definition/User";
import type { ConnectionsData } from "./settings-connections";
import type { Route } from "./+types/settings-connections-server";

async function requireUser(request: Request): Promise<User> {
  const user = await getAuthenticatedUser(request);
  if (!user || user.mustChangePassword)
    throw new McpAuthorizationError("access_denied", 401);
  return user;
}

/** Lists only the requesting account's safe connection metadata. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  try {
    const user = await requireUser(request);
    const services = await getApplicationServices();
    const picaMobile = await loadPicaMobileView(services, user, request);
    const view: ConnectionsData = {
      ...(picaMobile ? { picaMobile } : {}),
      mcpDevices: await services.mcpDeviceService.list(user.id),
      audience: await readLocalStateAudience(services, user),
    };
    return authorizationResponse(view);
  } catch (error: unknown) {
    logCaughtError("settings_connections", error);

    throw authorizationFailure(error);
  }
}

/** Persists, for administrators, the Pica Mobile port, and revokes a paired machine of the account. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  try {
    if (request.method !== "POST")
      throw new McpAuthorizationError("invalid_request", 405);
    requireAuthorizationOrigin(request);
    const user = await requireUser(request);
    const services = await getApplicationServices();
    const form = await request.formData();
    const intent = form.get("intent");
    if (intent === "revoke-mcp-device")
      return await handleRevokeMcpDevice(services, user, form);
    if (intent !== "update-pica-mobile-port")
      throw new McpAuthorizationError("invalid_request");
    return await handleUpdatePicaMobilePort(services, user, form);
  } catch (error: unknown) {
    logCaughtError("settings_connections", error);

    return authorizationFailure(error);
  }
}
