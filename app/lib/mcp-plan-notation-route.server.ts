import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
} from "@/app/lib/mcp-device-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { McpPlanNotationApi } from "@/backend/service/mcp/plan/McpPlanNotationApi";
import { McpPlanNotationError } from "@/backend/service/mcp/plan/McpPlanNotationError";

import type { User } from "@/definition/User";

/** Largest body of the plan notation API, in bytes, as the interface states it. */
const MAXIMUM_BODY_BYTES = 2_000_000;

/** The methods the plan notation API serves. */
type McpPlanNotationMethod = "GET" | "POST" | "PUT";

/** Everything a handler of the plan notation API works with. */
export interface McpPlanNotationCall {
  readonly api: McpPlanNotationApi;
  readonly actor: User;
  readonly request: Request;
}

/** Answers one method of a plan notation resource. */
export type McpPlanNotationHandler = (
  call: McpPlanNotationCall,
) => Promise<Response>;

/** The handlers of one plan notation resource by method. */
export type McpPlanNotationHandlers = Readonly<
  Partial<Record<McpPlanNotationMethod, McpPlanNotationHandler>>
>;

function isServedMethod(
  method: string,
  handlers: McpPlanNotationHandlers,
): method is McpPlanNotationMethod {
  return Object.hasOwn(handlers, method);
}

/** Creates the API over the plan service of the `mcp` channel and the device token check. */
async function createApi(): Promise<McpPlanNotationApi> {
  const services = await getApplicationServices();
  return new McpPlanNotationApi(
    { plans: services.mcpPlanService(), wiki: services.wikiService },
    { devices: services.mcpDeviceService, accounts: services.userService },
  );
}

/**
 * Answers a plan notation request with JSON that no cache keeps.
 *
 * @param body - The answer of the interface.
 * @param status - The HTTP status.
 */
export function mcpPlanNotationResponse(body: unknown, status = 200): Response {
  return mcpDeviceResponse(body, status);
}

/**
 * Answers a failure of a plan notation request.
 *
 * @remarks
 * The body holds the code, the findings of `notation_invalid` and the
 * current revision of `conflict`; never a message of a service and never a
 * part of the request.
 */
function mcpPlanNotationFailure(error: unknown): Response {
  if (!(error instanceof McpPlanNotationError)) return mcpDeviceFailure(error);
  return mcpPlanNotationResponse(error.body(), error.status);
}

/**
 * Runs one request of the plan notation API (PAGE-250).
 *
 * @param request - The request of the machine.
 * @param handlers - The methods the resource serves.
 * @returns The answer; a failure answers `{ "error": "<code>", "issues"?, "currentRevision"? }`.
 *
 * @remarks
 * Only the bearer token admits a request, checked and noted by the device
 * API; browser cookies play no part. Failures of the token check keep the
 * mapping of the device API.
 */
export async function runMcpPlanNotationRoute(
  request: Request,
  handlers: McpPlanNotationHandlers,
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
    return mcpPlanNotationFailure(error);
  }
}

/** Reads a request body as text, refusing more than the limit while it arrives. */
async function readLimitedText(request: Request): Promise<string> {
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAXIMUM_BODY_BYTES)
    throw new McpPlanNotationError("too_large");
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
      throw new McpPlanNotationError("too_large");
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

/** Reads the text of a body; every failure to read it but its size is an invalid request. */
async function readBodyText(request: Request): Promise<string> {
  try {
    return await readLimitedText(request);
  } catch (error: unknown) {
    if (error instanceof McpPlanNotationError) throw error;
    throw new McpPlanNotationError("invalid_request");
  }
}

/**
 * Reads the JSON object of a plan notation request.
 *
 * @param request - The request with `Content-Type: application/json`.
 * @returns The object, its fields still untrusted.
 * @throws {McpPlanNotationError} `too_large` above 2,000,000 bytes,
 * `invalid_request` for another content type, malformed JSON or anything
 * but an object.
 *
 * @remarks
 * A syntax error is replaced and not logged: the message of the parser can
 * quote the input.
 */
export async function readMcpPlanNotationBody(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  const text = await readBodyText(request);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new McpPlanNotationError("invalid_request");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new McpPlanNotationError("invalid_request");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new McpPlanNotationError("invalid_request");
  return Object.fromEntries(Object.entries(body));
}
