import { mcpDeviceResponse } from "@/app/lib/mcp-device-response.server";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { User } from "@/definition/User";

/**
 * Revokes a machine that is paired with the signed-in account (PAGE-243).
 *
 * @param services - Services of the request.
 * @param user - The signed-in user.
 * @param formData - Submitted form with the `deviceId` field.
 * @returns A JSON response; a machine of another account is never touched.
 *
 * @remarks
 * The token of the machine is refused from its next request on.
 */
export async function handleRevokeMcpDevice(
  services: ApplicationServices,
  user: User,
  formData: FormData,
): Promise<Response> {
  const deviceId = formData.get("deviceId");

  if (typeof deviceId !== "string" || deviceId === "") {
    return mcpDeviceResponse({ error: "invalid_request" }, 400);
  }

  const isRevoked = await services.mcpDeviceService.revoke(user.id, deviceId);

  return mcpDeviceResponse({ mcpDevice: { isRevoked } });
}
