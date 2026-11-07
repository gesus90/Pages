import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
  readMcpDeviceBody,
} from "@/app/lib/mcp-device-response.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { Route } from "./+types/api-mcp-v1-pairing-cancel";

/** Cancels a pairing on behalf of the machine that started it (`POST /api/mcp/v1/pairing/cancel`, PAGE-243). */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  if (request.method !== "POST") return mcpDeviceMethodNotAllowed("POST");
  try {
    const body = await readMcpDeviceBody(request);
    const services = await getApplicationServices();
    await services.mcpDevicePairingService.cancel({
      userCode: body.userCode,
      deviceSecret: body.deviceSecret,
    });
    return mcpDeviceResponse({ cancelled: true });
  } catch (error: unknown) {
    return mcpDeviceFailure(error);
  }
}

/** Answers every read of the address with `405`. */
export function loader(): Response {
  return mcpDeviceMethodNotAllowed("POST");
}
