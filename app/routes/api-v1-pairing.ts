import {
  clientSocketAddressContext,
  getClientAddress,
} from "@/app/lib/client-address.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  authorizationFailure,
  authorizationResponse,
  readAuthorizationJson,
} from "@/app/lib/authorization-response.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { PairingRateError } from "@/backend/service/mcp/PairingThrottle";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Route } from "./+types/api-v1-pairing";

/** Serves only device POST requests; browser cookies never establish device authority. */
export async function action({
  request,
  params,
  context,
}: Route.ActionArgs): Promise<Response> {
  try {
    if (request.method !== "POST")
      throw new McpAuthorizationError("invalid_request", 405);
    const input = await readAuthorizationJson(request);
    const { pairingService } = await getApplicationServices();
    if (params.endpoint === "token")
      return authorizationResponse(await pairingService.exchange(input));
    if (params.endpoint === "cancel")
      return authorizationResponse(await pairingService.cancel(input));
    if (params.endpoint !== undefined)
      throw new McpAuthorizationError("invalid_request", 404);
    return authorizationResponse(
      await pairingService.begin(input, {
        socket: context.get(clientSocketAddressContext),
        forwarded: getClientAddress(request),
      }),
      201,
    );
  } catch (error: unknown) {
    logCaughtError("api_v1_pairing", error);

    const response = authorizationFailure(error);
    if (error instanceof PairingRateError)
      response.headers.set("Retry-After", String(error.retryAfter));
    return response;
  }
}

/** Rejects non-POST device access without revealing any state. */
export function loader(): Response {
  return authorizationFailure(
    new McpAuthorizationError("invalid_request", 405),
  );
}
