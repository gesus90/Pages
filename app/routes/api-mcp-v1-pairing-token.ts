import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
  readMcpDeviceBody,
} from "@/app/lib/mcp-device-response.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { Route } from "./+types/api-mcp-v1-pairing-token";

/**
 * Answers the query for the result of a pairing (`POST /api/mcp/v1/pairing/token`, PAGE-243).
 *
 * @remarks
 * The token is in the one `200` answer of a confirmed request; every other
 * state is a `400` with the error code of the interface.
 */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  if (request.method !== "POST") return mcpDeviceMethodNotAllowed("POST");
  try {
    const body = await readMcpDeviceBody(request);
    const services = await getApplicationServices();
    const token = await services.mcpDevicePairingService.collect({
      userCode: body.userCode,
      deviceSecret: body.deviceSecret,
    });
    return mcpDeviceResponse(token);
  } catch (error: unknown) {
    return mcpDeviceFailure(error);
  }
}

/** Answers every read of the address with `405`. */
export function loader(): Response {
  return mcpDeviceMethodNotAllowed("POST");
}
