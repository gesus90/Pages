import { clientSocketAddressContext } from "@/app/lib/client-address.server";
import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
  readMcpDeviceBody,
} from "@/app/lib/mcp-device-response.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { Route } from "./+types/api-mcp-v1-pairing";

/**
 * Starts the pairing of a machine (`POST /api/mcp/v1/pairing`, PAGE-243).
 *
 * @remarks
 * Answers `201` with the code to show, the secret to keep and the link to
 * open; `429` with `Retry-After` for an address over its limits. Neither
 * the body nor the answer is logged.
 */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<Response> {
  if (request.method !== "POST") return mcpDeviceMethodNotAllowed("POST");
  try {
    const body = await readMcpDeviceBody(request);
    const services = await getApplicationServices();
    const started = await services.mcpDevicePairingService.start({
      device: body.device,
      clientVersion: body.clientVersion,
      address: context.get(clientSocketAddressContext),
      origin: new URL(request.url).origin,
    });
    return mcpDeviceResponse(started, 201);
  } catch (error: unknown) {
    return mcpDeviceFailure(error);
  }
}

/** Answers every read of the address with `405`; the pairing is started with `POST`. */
export function loader(): Response {
  return mcpDeviceMethodNotAllowed("POST");
}
