import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
} from "@/app/lib/mcp-device-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { McpWorkspaceApi } from "@/backend/service/mcp/workspace/McpWorkspaceApi";
import {
  McpWorkspaceError,
  toMcpWorkspaceError,
} from "@/backend/service/mcp/workspace/McpWorkspaceError";

import type { McpWorkspaceActor } from "@/backend/service/mcp/workspace/McpWorkspaceApi";

/** Longest body of the workspace API, in characters, as in the dialogs of the interface. */
const MAXIMUM_BODY_CHARACTERS = 50_000;

/** A character takes at most four bytes of UTF-8, so a larger body cannot hold that few characters. */
const BYTES_PER_CHARACTER = 4;

/** The methods the workspace API serves. */
type McpWorkspaceMethod = "GET" | "POST" | "PATCH";

/** Everything a handler of the workspace API works with. */
export interface McpWorkspaceCall {
  readonly api: McpWorkspaceApi;
  readonly actor: McpWorkspaceActor;
  readonly request: Request;
}

/** Answers one method of a workspace resource. */
export type McpWorkspaceHandler = (call: McpWorkspaceCall) => Promise<Response>;

/** The handlers of one workspace resource by method. */
export type McpWorkspaceHandlers = Readonly<
  Partial<Record<McpWorkspaceMethod, McpWorkspaceHandler>>
>;

function isServedMethod(
  method: string,
  handlers: McpWorkspaceHandlers,
): method is McpWorkspaceMethod {
  return Object.hasOwn(handlers, method);
}

/** Creates the API over the services of the interface and the device token check. */
async function createApi(): Promise<McpWorkspaceApi> {
  const services = await getApplicationServices();
  return new McpWorkspaceApi(
    {
      local: services.agentWorkspaceService,
      remote: services.remoteWorkspaceService,
      connections: services.remoteConnectionService,
    },
    { devices: services.mcpDeviceService, accounts: services.userService },
  );
}

/**
 * Answers a workspace request with JSON that no cache keeps.
 *
 * @param body - The answer of the interface.
 * @param status - The HTTP status.
 */
export function mcpWorkspaceResponse(body: unknown, status = 200): Response {
  return mcpDeviceResponse(body, status);
}

/**
 * Answers a failure of a workspace request.
 *
 * @remarks
 * The body holds the code and, for a few codes, the stable finding; never a
 * message of a service and never a part of the request, which may hold a
 * password, a key or a passphrase.
 */
function mcpWorkspaceFailure(error: unknown): Response {
  const failure = toMcpWorkspaceError(error);
  if (failure === null) return mcpDeviceFailure(error);
  return mcpWorkspaceResponse(
    failure.detail === null
      ? { error: failure.code }
      : { error: failure.code, detail: failure.detail },
    failure.status,
  );
}

/**
 * Runs one request of the workspace API (PAGE-245).
 *
 * @param request - The request of the machine.
 * @param handlers - The methods the resource serves.
 * @returns The answer; a failure answers `{ "error": "<code>" }`, with a `detail` for some codes.
 *
 * @remarks
 * Only the bearer token admits a request, checked and noted by the device
 * API; browser cookies play no part. Failures of the token check keep the
 * mapping of the device API, failures of the services become the codes of
 * the workspace interface.
 */
export async function runMcpWorkspaceRoute(
  request: Request,
  handlers: McpWorkspaceHandlers,
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
    return mcpWorkspaceFailure(error);
  }
}

/** Reads a request body as text, refusing more than the limit while it arrives. */
async function readLimitedText(
  request: Request,
  maximumBytes: number,
): Promise<string> {
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > maximumBytes)
    throw new McpWorkspaceError("invalid_request");
  if (!request.body) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = request.body.getReader();
  const parts: string[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maximumBytes) {
      await reader.cancel();
      throw new McpWorkspaceError("invalid_request");
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

/** Reads the text of a body; every failure to read it is an invalid request, without its cause. */
async function readBodyText(
  request: Request,
  maximumCharacters: number,
): Promise<string> {
  let text: string;
  try {
    text = await readLimitedText(
      request,
      maximumCharacters * BYTES_PER_CHARACTER,
    );
  } catch (error: unknown) {
    if (error instanceof McpWorkspaceError) throw error;
    throw new McpWorkspaceError("invalid_request");
  }
  if (text.length > maximumCharacters)
    throw new McpWorkspaceError("invalid_request");
  return text;
}

/**
 * Reads the JSON object of a workspace request.
 *
 * @param request - The request with `Content-Type: application/json`.
 * @param maximumCharacters - The longest body the resource takes; 50,000
 * characters for the workspace API, more for the agent API with its
 * documents and images (PAGE-267).
 * @returns The object, its fields still untrusted; an empty body counts as `{}`.
 * @throws {McpWorkspaceError} `invalid_request` for another content type, a body
 * above the limit, malformed JSON or anything but an object.
 *
 * @remarks
 * A syntax error is replaced and not logged: the message of the parser can
 * quote the input, which may hold a password or a key.
 */
export async function readMcpWorkspaceBody(
  request: Request,
  maximumCharacters = MAXIMUM_BODY_CHARACTERS,
): Promise<Readonly<Record<string, unknown>>> {
  const text = await readBodyText(request, maximumCharacters);
  if (text.trim() === "") return {};
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new McpWorkspaceError("invalid_request");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new McpWorkspaceError("invalid_request");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new McpWorkspaceError("invalid_request");
  return Object.fromEntries(Object.entries(body));
}

/**
 * Reads a path parameter of a workspace resource.
 *
 * @param value - The parameter as React Router passes it.
 * @throws {McpWorkspaceError} `not_found` for a missing parameter.
 */
export function requireMcpWorkspaceParameter(
  value: string | undefined,
): string {
  if (value === undefined || value.trim() === "")
    throw new McpWorkspaceError("not_found");
  return value;
}
