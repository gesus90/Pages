import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
} from "@/app/lib/mcp-device-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { McpWikiApi } from "@/backend/service/mcp/wiki/McpWikiApi";
import {
  McpWikiError,
  toMcpWikiError,
} from "@/backend/service/mcp/wiki/McpWikiError";

import type { McpWikiContext } from "@/backend/service/mcp/wiki/McpWikiContext";

/**
 * Largest JSON body of the wiki API: a page text of 1 MiB, which JSON may
 * escape to several times its size, with room for the fields around it.
 */
const MAXIMUM_BODY_BYTES = 8 * 1024 * 1024;

/** The methods the wiki API serves. */
type McpWikiMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Everything a handler of the wiki API works with. */
export interface McpWikiCall {
  readonly api: McpWikiApi;
  readonly context: McpWikiContext;
  readonly request: Request;
}

/** Answers one method of a wiki resource. */
export type McpWikiHandler = (call: McpWikiCall) => Promise<Response>;

/** The handlers of one wiki resource by method. */
export type McpWikiHandlers = Readonly<
  Partial<Record<McpWikiMethod, McpWikiHandler>>
>;

function isServedMethod(
  method: string,
  handlers: McpWikiHandlers,
): method is McpWikiMethod {
  return Object.hasOwn(handlers, method);
}

/** Creates the wiki API over the announcing wiki service of the interface. */
async function createApi(): Promise<McpWikiApi> {
  const services = await getApplicationServices();
  return new McpWikiApi(
    {
      wiki: services.wikiService,
      users: services.userService,
      calls: services.pagesEventPublisher,
      operations: services.mcpWikiOperations,
    },
    { devices: services.mcpDeviceService, accounts: services.userService },
  );
}

/**
 * Answers a wiki request with JSON that no cache keeps.
 *
 * @param body - The answer of the interface.
 * @param status - The HTTP status.
 */
export function mcpWikiResponse(body: unknown, status = 200): Response {
  return mcpDeviceResponse(body, status);
}

/**
 * Runs one request of the wiki API (PAGE-257).
 *
 * @param request - The request of the machine.
 * @param handlers - The methods the resource serves.
 * @returns The answer; a failure answers `{ "error": "<code>" }`, a conflict
 * also the current `revision`, and nothing else.
 *
 * @remarks
 * Only the bearer token admits a request, checked and noted by the device
 * API; browser cookies play no part. Failures of the token check keep the
 * mapping of the device API, failures of the wiki service become the codes
 * of the wiki interface.
 */
export async function runMcpWikiRoute(
  request: Request,
  handlers: McpWikiHandlers,
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
    const failure = toMcpWikiError(error);
    if (failure === null) return mcpDeviceFailure(error);
    return mcpWikiResponse(failure.toBody(), failure.status);
  }
}

/** Reads a request body as text, refusing more than the limit while it arrives. */
async function readLimitedText(request: Request): Promise<string> {
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAXIMUM_BODY_BYTES)
    throw new McpWikiError("invalid_request");
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
      throw new McpWikiError("invalid_request");
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

/**
 * Reads the JSON object of a wiki request.
 *
 * @param request - The request with `Content-Type: application/json`.
 * @returns The object, its fields still untrusted; an empty body counts as `{}`.
 * @throws {McpWikiError} `invalid_request` for another content type, a body
 * above the limit, malformed JSON or anything but an object.
 */
export async function readMcpWikiBody(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  let text: string;
  try {
    text = await readLimitedText(request);
  } catch (error: unknown) {
    if (error instanceof McpWikiError) throw error;
    throw new McpWikiError("invalid_request");
  }
  if (text.trim() === "") return {};
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new McpWikiError("invalid_request");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new McpWikiError("invalid_request");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new McpWikiError("invalid_request");
  return Object.fromEntries(Object.entries(body));
}

/**
 * Reads a path parameter of a wiki resource.
 *
 * @param value - The parameter as React Router passes it.
 * @throws {McpWikiError} `not_found` for a missing parameter.
 */
export function requireMcpWikiParameter(value: string | undefined): string {
  if (value === undefined || value.trim() === "")
    throw new McpWikiError("not_found");
  return value;
}

/**
 * Reads the query of a wiki request.
 *
 * @param request - The request.
 */
export function mcpWikiQuery(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}
