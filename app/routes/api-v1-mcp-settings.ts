import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  oauthFailure,
  oauthResponse,
  readOAuthJson,
  requireOAuthOrigin,
} from "@/app/lib/oauth-response.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type { Route } from "./+types/api-v1-mcp-settings";

/** Returns the owner's OAuth re-verification preference and grants without credentials. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.mustChangePassword)
      throw new McpAuthorizationError("access_denied", 401);
    const services = await getApplicationServices();
    return oauthResponse(await services.oauthGrantService.get(user.id));
  } catch (error: unknown) {
    return oauthFailure(error);
  }
}

/** Changes the owner's duration or revokes one owner-bound HTTP-OAuth grant. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  try {
    if (request.method !== "POST")
      throw new McpAuthorizationError("invalid_request", 405);
    requireOAuthOrigin(request);
    const user = await getAuthenticatedUser(request);
    if (!user || user.mustChangePassword)
      throw new McpAuthorizationError("access_denied", 401);
    const input = await readOAuthJson(request);
    const { oauthGrantService: service } = await getApplicationServices();
    if (input.operation === "set-duration")
      await service.setDuration(user.id, input.durationSeconds);
    else if (input.operation === "revoke" && typeof input.id === "string")
      await service.revoke(user.id, input.id);
    else throw new McpAuthorizationError("invalid_request");
    return oauthResponse({ updated: true });
  } catch (error: unknown) {
    return oauthFailure(error);
  }
}
