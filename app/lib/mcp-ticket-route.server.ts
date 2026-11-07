import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
} from "@/app/lib/mcp-device-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { McpTicketApi } from "@/backend/service/mcp/ticket/McpTicketApi";
import {
  McpTicketError,
  toMcpTicketError,
} from "@/backend/service/mcp/ticket/McpTicketError";

import type { McpTicketContext } from "@/backend/service/mcp/ticket/McpTicketContext";

/** Largest JSON body of the ticket API: a description of 65,536 characters with room for escaping. */
const MAXIMUM_BODY_BYTES = 1024 * 1024;

/** The methods the ticket API serves. */
type McpTicketMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Everything a handler of the ticket API works with. */
export interface McpTicketCall {
  readonly api: McpTicketApi;
  readonly context: McpTicketContext;
  readonly request: Request;
}

/** Answers one method of a ticket resource. */
export type McpTicketHandler = (call: McpTicketCall) => Promise<Response>;

/** The handlers of one ticket resource by method. */
export type McpTicketHandlers = Readonly<
  Partial<Record<McpTicketMethod, McpTicketHandler>>
>;

function isServedMethod(
  method: string,
  handlers: McpTicketHandlers,
): method is McpTicketMethod {
  return Object.hasOwn(handlers, method);
}

/** Creates the ticket API over the services of the interface. */
async function createApi(): Promise<McpTicketApi> {
  const services = await getApplicationServices();
  return new McpTicketApi(
    {
      tasks: services.taskService,
      templates: services.taskTemplateService,
      attachments: services.taskAttachmentService,
      projects: services.projectService,
      users: services.userService,
    },
    { devices: services.mcpDeviceService, accounts: services.userService },
  );
}

/**
 * Answers a ticket request with JSON that no cache keeps.
 *
 * @param body - The answer of the interface.
 * @param status - The HTTP status.
 */
export function mcpTicketResponse(body: unknown, status = 200): Response {
  return mcpDeviceResponse(body, status);
}

/**
 * Runs one request of the ticket API (PAGE-242).
 *
 * @param request - The request of the machine.
 * @param handlers - The methods the resource serves.
 * @returns The answer; a failure answers `{ "error": "<code>" }` and nothing else.
 *
 * @remarks
 * Only the bearer token admits a request, checked and noted by the device
 * API; browser cookies play no part. Failures of the token check keep the
 * mapping of the device API, failures of the ticket services become the
 * codes of the ticket interface.
 */
export async function runMcpTicketRoute(
  request: Request,
  handlers: McpTicketHandlers,
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
    const failure = toMcpTicketError(error);
    if (failure === null) return mcpDeviceFailure(error);
    return mcpTicketResponse({ error: failure.code }, failure.status);
  }
}

/** Reads a request body as text, refusing more than the limit while it arrives. */
async function readLimitedText(request: Request): Promise<string> {
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAXIMUM_BODY_BYTES)
    throw new McpTicketError("invalid_request");
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
      throw new McpTicketError("invalid_request");
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

/**
 * Reads the JSON object of a ticket request.
 *
 * @param request - The request with `Content-Type: application/json`.
 * @returns The object, its fields still untrusted; an empty body counts as `{}`.
 * @throws {McpTicketError} `invalid_request` for another content type, a body
 * above the limit, malformed JSON or anything but an object.
 */
export async function readMcpTicketBody(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  let text: string;
  try {
    text = await readLimitedText(request);
  } catch (error: unknown) {
    if (error instanceof McpTicketError) throw error;
    throw new McpTicketError("invalid_request");
  }
  if (text.trim() === "") return {};
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new McpTicketError("invalid_request");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new McpTicketError("invalid_request");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new McpTicketError("invalid_request");
  return Object.fromEntries(Object.entries(body));
}

/**
 * Reads a path parameter of a ticket resource.
 *
 * @param value - The parameter as React Router passes it.
 * @throws {McpTicketError} `not_found` for a missing parameter.
 */
export function requireMcpTicketParameter(value: string | undefined): string {
  if (value === undefined || value.trim() === "")
    throw new McpTicketError("not_found");
  return value;
}
