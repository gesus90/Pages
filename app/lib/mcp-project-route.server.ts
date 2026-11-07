import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
} from "@/app/lib/mcp-device-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { McpProjectApi } from "@/backend/service/mcp/project/McpProjectApi";
import {
  McpProjectError,
  toMcpProjectError,
} from "@/backend/service/mcp/project/McpProjectError";

import type { McpProjectContext } from "@/backend/service/mcp/project/McpProjectContext";

/** Largest JSON body of the project API: an icon of 2 MiB in Base64 with room for the JSON around it. */
const MAXIMUM_BODY_BYTES = 4 * 1024 * 1024;

/** The methods the project API serves. */
type McpProjectMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Everything a handler of the project API works with. */
export interface McpProjectCall {
  readonly api: McpProjectApi;
  readonly context: McpProjectContext;
  readonly request: Request;
}

/** Answers one method of a project resource. */
export type McpProjectHandler = (call: McpProjectCall) => Promise<Response>;

/** The handlers of one project resource by method. */
export type McpProjectHandlers = Readonly<
  Partial<Record<McpProjectMethod, McpProjectHandler>>
>;

function isServedMethod(
  method: string,
  handlers: McpProjectHandlers,
): method is McpProjectMethod {
  return Object.hasOwn(handlers, method);
}

/**
 * Creates the project API over the services of the interface.
 *
 * @remarks
 * The project service acts on the MCP channel: an account with the
 * administrator role counts as administrator whatever role mode its browser
 * keeps, as the interface specifies for archiving and deleting. Every other
 * rule is that of the interface.
 */
async function createApi(): Promise<McpProjectApi> {
  const services = await getApplicationServices();
  return new McpProjectApi(
    {
      projects: services.projectService.forChannel("mcp"),
      gitHub: services.gitHubSyncService,
      tasks: services.taskService,
      users: services.userService,
      events: services.pagesEventPublisher,
    },
    { devices: services.mcpDeviceService, accounts: services.userService },
  );
}

/**
 * Answers a project request with JSON that no cache keeps.
 *
 * @param body - The answer of the interface.
 * @param status - The HTTP status.
 */
export function mcpProjectResponse(body: unknown, status = 200): Response {
  return mcpDeviceResponse(body, status);
}

/**
 * Runs one request of the project API (PAGE-244).
 *
 * @param request - The request of the machine.
 * @param handlers - The methods the resource serves.
 * @returns The answer; a failure answers `{ "error": "<code>" }` and nothing else.
 *
 * @remarks
 * Only the bearer token admits a request, checked and noted by the device
 * API; browser cookies play no part. Failures of the token check keep the
 * mapping of the device API, failures of the project services become the
 * codes of the project interface. The body of a request is never logged,
 * since it may carry a GitHub token.
 */
export async function runMcpProjectRoute(
  request: Request,
  handlers: McpProjectHandlers,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const handler = isServedMethod(method, handlers)
    ? handlers[method]
    : undefined;
  if (handler === undefined)
    return mcpDeviceMethodNotAllowed(Object.keys(handlers).join(", "));
  try {
    const api = await createApi();
    const context = await api.authenticate(
      request.headers.get("Authorization"),
    );
    return await handler({ api, context, request });
  } catch (error: unknown) {
    const failure = toMcpProjectError(error);
    if (failure === null) return mcpDeviceFailure(error);
    return mcpProjectResponse({ error: failure.code }, failure.status);
  }
}

/** Reads a request body as text, refusing more than the limit while it arrives. */
async function readLimitedText(request: Request): Promise<string> {
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAXIMUM_BODY_BYTES)
    throw new McpProjectError("invalid_request");
  if (!request.body) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = request.body.getReader();
  const parts: string[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAXIMUM_BODY_BYTES) {
      await reader.cancel();
      throw new McpProjectError("invalid_request");
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

/**
 * Reads the JSON object of a project request.
 *
 * @param request - The request with `Content-Type: application/json`.
 * @returns The object, its fields still untrusted; an empty body counts as `{}`.
 * @throws {McpProjectError} `invalid_request` for another content type, a body
 * above the limit, malformed JSON or anything but an object.
 */
export async function readMcpProjectBody(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  let text: string;
  try {
    text = await readLimitedText(request);
  } catch (error: unknown) {
    if (error instanceof McpProjectError) throw error;
    throw new McpProjectError("invalid_request");
  }
  if (text.trim() === "") return {};
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new McpProjectError("invalid_request");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new McpProjectError("invalid_request");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new McpProjectError("invalid_request");
  return Object.fromEntries(Object.entries(body));
}

/**
 * Reads a path parameter of a project resource.
 *
 * @param value - The parameter as React Router passes it.
 * @throws {McpProjectError} `not_found` for a missing parameter.
 */
export function requireMcpProjectParameter(value: string | undefined): string {
  if (value === undefined || value.trim() === "")
    throw new McpProjectError("not_found");
  return value;
}
