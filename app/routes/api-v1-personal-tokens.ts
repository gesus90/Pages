import { getAuthenticatedUser } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  oauthFailure,
  oauthResponse,
  readOAuthJson,
  requireOAuthOrigin,
} from "@/app/lib/oauth-response.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import type { Route } from "./+types/api-v1-personal-tokens";

/** Lists public token summaries only for the signed-in owner. */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user || user.mustChangePassword)
      throw new McpAuthorizationError("access_denied", 401);
    const services = await getApplicationServices();
    return oauthResponse({
      tokens: await services.personalAgentTokenService.list(user.id),
    });
  } catch (error: unknown) {
    return oauthFailure(error);
  }
}

/** Creates, revokes or rotates an owner's personal stdio token; clear text is returned once. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  try {
    if (request.method !== "POST")
      throw new McpAuthorizationError("invalid_request", 405);
    requireOAuthOrigin(request);
    const user = await getAuthenticatedUser(request);
    if (!user || user.mustChangePassword)
      throw new McpAuthorizationError("access_denied", 401);
    const input = await readOAuthJson(request);
    const { personalAgentTokenService: service } =
      await getApplicationServices();
    if (input.operation === "create")
      return oauthResponse(
        await service.create(user.id, input.name, input.expiresAt),
        201,
      );
    if (typeof input.id !== "string")
      throw new McpAuthorizationError("invalid_request");
    if (input.operation === "rotate")
      return oauthResponse(await service.rotate(user.id, input.id), 201);
    if (input.operation !== "revoke")
      throw new McpAuthorizationError("invalid_request");
    await service.revoke(user.id, input.id);
    return oauthResponse({ revoked: true });
  } catch (error: unknown) {
    return oauthFailure(error);
  }
}
