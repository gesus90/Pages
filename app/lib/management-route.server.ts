import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { getApplicationServices } from "./services.server";
import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
} from "./mcp-device-response.server";

import type { ManagementOperation } from "@/definition/Management";

const MAXIMUM_BODY_BYTES = 7 * 1024 * 1024;

/** Reads a bounded JSON body before decoding an avatar or validating a mutation. */
export async function readManagementBody(
  request: Request,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "content_type",
    });
  if (Number(request.headers.get("content-length")) > MAXIMUM_BODY_BYTES)
    throw new AgentOperationError("PAYLOAD_TOO_LARGE");
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = request.body?.getReader();
  if (reader)
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAXIMUM_BODY_BYTES) {
        await reader.cancel();
        throw new AgentOperationError("PAYLOAD_TOO_LARGE");
      }
      chunks.push(chunk.value);
    }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AgentOperationError("INVALID_REQUEST", { reason: "json" });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new AgentOperationError("INVALID_REQUEST", { reason: "validation" });
  return Object.fromEntries(Object.entries(parsed));
}

/** Uses the existing paired-machine authentication and error envelope with the new contract fields. */
export async function runManagementRoute(
  request: Request,
  operation: ManagementOperation,
  identifiers: Readonly<Record<string, string | undefined>> = {},
): Promise<Response> {
  try {
    const services = await getApplicationServices();
    const actor = await services.mcpUserApi.authenticate(
      request.headers.get("authorization"),
    );
    const input =
      request.method === "GET"
        ? Object.fromEntries(new URL(request.url).searchParams)
        : await readManagementBody(request);
    const result = await services.managementService.call(actor.id, operation, {
      ...input,
      ...identifiers,
    });
    return mcpDeviceResponse(result, operation.endsWith("_create") ? 201 : 200);
  } catch (error: unknown) {
    if (error instanceof AgentOperationError)
      return mcpDeviceResponse(
        { error: error.code, ...error.details },
        error.status,
      );
    return mcpDeviceFailure(error);
  }
}

/** Explicitly rejects account deletion for Management, although this resource has no deletion method. */
export async function rejectManagementAccountDeletion(
  request: Request,
): Promise<Response> {
  try {
    const services = await getApplicationServices();
    const actor = await services.mcpUserApi.authenticate(
      request.headers.get("authorization"),
    );
    const account = await services.administrationService.getContext(actor.id);
    const policy = new UserPolicyService("mcp");
    if (policy.isManagement(account) && !policy.isAdministrator(account))
      return mcpDeviceResponse(
        { error: "FORBIDDEN", reason: "core_system" },
        403,
      );
    return mcpDeviceMethodNotAllowed("GET, PATCH");
  } catch (error: unknown) {
    return mcpDeviceFailure(error);
  }
}
