import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
} from "@/app/lib/mcp-device-response.server";
import { readMcpWorkspaceBody } from "@/app/lib/mcp-workspace-route.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { validateAvatarImage } from "@/app/lib/settings-actions/avatar-upload.server";
import { McpAgentApi } from "@/backend/service/mcp/agent/McpAgentApi";
import {
  McpAgentError,
  toMcpAgentError,
} from "@/backend/service/mcp/agent/McpAgentError";
import { McpAgentRequest } from "@/backend/service/mcp/agent/McpAgentRequest";
import { MAXIMUM_AVATAR_BYTES } from "@/definition/User";

import type { McpAgentActor } from "@/backend/service/mcp/agent/McpAgentApi";
import type { AgentAvatarUpload } from "@/backend/service/employee/AgentEmployeeAdministration";

/** Longest body of the agent API: the three documents with room for their JSON escapes. */
const MAXIMUM_BODY_CHARACTERS = 200_000;

/** Longest body of an image: the Base64 form of the largest profile image and its type. */
const MAXIMUM_IMAGE_BODY_CHARACTERS =
  Math.ceil(MAXIMUM_AVATAR_BYTES / 3) * 4 + 1_000;

/** Base64 as `Buffer.from` would also accept it, but without whitespace or the URL alphabet. */
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/** The methods the agent API serves. */
type McpAgentMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Everything a handler of the agent API works with. */
export interface McpAgentCall {
  readonly api: McpAgentApi;
  readonly actor: McpAgentActor;
  readonly request: Request;
}

/** Answers one method of an agent resource. */
export type McpAgentHandler = (call: McpAgentCall) => Promise<Response>;

/** The handlers of one agent resource by method. */
export type McpAgentHandlers = Readonly<
  Partial<Record<McpAgentMethod, McpAgentHandler>>
>;

function isServedMethod(
  method: string,
  handlers: McpAgentHandlers,
): method is McpAgentMethod {
  return Object.hasOwn(handlers, method);
}

/** Creates the API over the administration of agents and the device token check. */
async function createApi(): Promise<McpAgentApi> {
  const services = await getApplicationServices();
  return new McpAgentApi(
    services.agentEmployeeAdministration,
    { devices: services.mcpDeviceService, accounts: services.userService },
    services.agentTemplateService,
  );
}

/**
 * Answers an agent request with JSON that no cache keeps.
 *
 * @param body - The answer of the interface.
 * @param status - The HTTP status.
 */
export function mcpAgentResponse(body: unknown, status = 200): Response {
  return mcpDeviceResponse(body, status);
}

/**
 * Answers a failure of an agent request.
 *
 * @remarks
 * The body holds the code and, for `conflict`, the current revision; never a
 * message of a service and never a part of the request, which may hold a
 * document or an image.
 */
function mcpAgentFailure(error: unknown): Response {
  const failure = toMcpAgentError(error);
  if (failure === null) return mcpDeviceFailure(error);
  return mcpAgentResponse(
    failure.revision === null
      ? { error: failure.code }
      : { error: failure.code, revision: failure.revision },
    failure.status,
  );
}

/**
 * Runs one request of the agent API (PAGE-267).
 *
 * @param request - The request of the machine.
 * @param handlers - The methods the resource serves.
 * @returns The answer; a failure answers `{ "error": "<code>" }`, with the current `revision` for `conflict`.
 *
 * @remarks
 * Only the bearer token of a paired machine admits a request, and only for
 * an account with the administrator role, before the resource is even
 * looked at; browser cookies play no part.
 */
export async function runMcpAgentRoute(
  request: Request,
  handlers: McpAgentHandlers,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const handler = isServedMethod(method, handlers)
    ? handlers[method]
    : undefined;
  if (handler === undefined)
    return mcpDeviceMethodNotAllowed(Object.keys(handlers).join(", "));
  try {
    const api = await createApi();
    const actor = await api.authenticate(request.headers.get("Authorization"));
    return await handler({ api, actor, request });
  } catch (error: unknown) {
    return mcpAgentFailure(error);
  }
}

/**
 * Reads the JSON object of an agent request.
 *
 * @param request - The request with `Content-Type: application/json`.
 * @returns The object, its fields still untrusted; an empty body counts as `{}`.
 */
export async function readMcpAgentBody(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  return readMcpWorkspaceBody(request, MAXIMUM_BODY_CHARACTERS);
}

/**
 * Reads the image of `PUT /agents/{id}/image` with the limits of profile images.
 *
 * @param request - The request with `{ mimeType, dataBase64 }`.
 * @returns The validated image.
 * @throws {McpAgentError} `invalid_request` for malformed Base64, a type
 * other than JPEG, PNG or WebP, content that does not match it, or more
 * than 5 MiB.
 */
export async function readMcpAgentImage(
  request: Request,
): Promise<AgentAvatarUpload> {
  const body = McpAgentRequest.image(
    await readMcpWorkspaceBody(request, MAXIMUM_IMAGE_BODY_CHARACTERS),
  );
  if (!BASE64_PATTERN.test(body.dataBase64))
    throw new McpAgentError("invalid_request");
  const result = validateAvatarImage({
    data: Buffer.from(body.dataBase64, "base64"),
    mimeType: body.mimeType,
    filename: "avatar",
  });
  if (result.status !== "ready") throw new McpAgentError("invalid_request");
  return result.avatar;
}

/**
 * Reads a path parameter of an agent resource.
 *
 * @param value - The parameter as React Router passes it.
 * @throws {McpAgentError} `not_found` for a missing parameter.
 */
export function requireMcpAgentParameter(value: string | undefined): string {
  if (value === undefined || value.trim() === "")
    throw new McpAgentError("not_found");
  return value;
}
