import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
} from "@/app/lib/mcp-device-response.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { Route } from "./+types/api-mcp-v1-device";

/**
 * Checks a pairing (`GET /api/mcp/v1/device`, PAGE-243).
 *
 * @remarks
 * Only the bearer token admits a request; browser cookies play no part.
 * The check notes the time of use.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  if (request.method !== "GET") return mcpDeviceMethodNotAllowed("GET, DELETE");
  try {
    const services = await getApplicationServices();
    const identity = await services.mcpDeviceService.authenticate(
      request.headers.get("Authorization"),
    );
    return mcpDeviceResponse(identity);
  } catch (error: unknown) {
    return mcpDeviceFailure(error);
  }
}

/** Ends a pairing on behalf of the machine itself (`DELETE /api/mcp/v1/device`). */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  if (request.method !== "DELETE")
    return mcpDeviceMethodNotAllowed("GET, DELETE");
  try {
    const services = await getApplicationServices();
    await services.mcpDeviceService.unpair(
      request.headers.get("Authorization"),
    );
    return mcpDeviceResponse({ revoked: true });
  } catch (error: unknown) {
    return mcpDeviceFailure(error);
  }
}
