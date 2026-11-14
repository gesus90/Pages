import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
} from "@/app/lib/mcp-device-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { McpCalendarApi } from "@/backend/service/mcp/calendar/McpCalendarApi";
import {
  McpCalendarError,
  toMcpCalendarError,
} from "@/backend/service/mcp/calendar/McpCalendarError";

import type { McpCalendarContext } from "@/backend/service/mcp/calendar/McpCalendarContext";
import type { McpCalendarOutcome } from "@/backend/service/mcp/calendar/McpCalendarContract";

/** Largest JSON body: a description of 10,000 characters and 100 invitees, with room to spare. */
const MAXIMUM_BODY_BYTES = 256 * 1024;

/** The methods the calendar API serves. */
type McpCalendarMethod = "GET" | "POST" | "PATCH";

/** Everything a handler of the calendar API works with. */
export interface McpCalendarCall {
  readonly api: McpCalendarApi;
  readonly context: McpCalendarContext;
  readonly request: Request;
}

/** Answers one method of a calendar resource. */
export type McpCalendarHandler = (call: McpCalendarCall) => Promise<Response>;

/** The handlers of one calendar resource by method. */
export type McpCalendarHandlers = Readonly<
  Partial<Record<McpCalendarMethod, McpCalendarHandler>>
>;

function isServedMethod(
  method: string,
  handlers: McpCalendarHandlers,
): method is McpCalendarMethod {
  return Object.hasOwn(handlers, method);
}

/** Creates the calendar API over the calendar service of the interface. */
async function createApi(): Promise<McpCalendarApi> {
  const services = await getApplicationServices();
  return new McpCalendarApi(services.calendarService, {
    devices: services.mcpDeviceService,
    accounts: services.userService,
    agents: services.mcpAgentEmployees,
  });
}

/**
 * Answers a calendar request with JSON that no cache keeps.
 *
 * @param body - The answer of the interface.
 * @param status - The HTTP status.
 */
export function mcpCalendarResponse(body: unknown, status = 200): Response {
  return mcpDeviceResponse(body, status);
}

/**
 * Answers a change with an operation ID.
 *
 * @param outcome - The fresh answer or the stored answer of an identical earlier call.
 * @param isCreation - Whether the call creates an event; its first answer is `201`.
 * @returns The answer; a repetition carries the same body as the first one.
 */
export function mcpCalendarOutcomeResponse(
  outcome: McpCalendarOutcome<unknown>,
  isCreation = false,
): Response {
  return mcpCalendarResponse(
    outcome.result,
    isCreation && outcome.kind === "fresh" ? 201 : 200,
  );
}

/**
 * Runs one request of the calendar API (PAGE-301).
 *
 * @param request - The request of the machine.
 * @param handlers - The methods the resource serves.
 * @returns The answer; a failure answers `{ "error": "<code>" }`, with
 * `currentRevision` for a stale revision and `Retry-After` for `429` and `503`.
 *
 * @remarks
 * Only the bearer token admits a request, checked and noted by the device
 * API; browser cookies play no part. No message of a service and no part
 * of the request is part of a failure, so nothing of a foreign event leaks.
 */
export async function runMcpCalendarRoute(
  request: Request,
  handlers: McpCalendarHandlers,
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
    const failure = toMcpCalendarError(error);
    if (failure === null) return mcpDeviceFailure(error);
    return mcpDeviceResponse(
      failure.toBody(),
      failure.status,
      failure.headers(),
    );
  }
}

/** Reads a request body as text, refusing more than the limit while it arrives. */
async function readLimitedText(request: Request): Promise<string> {
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAXIMUM_BODY_BYTES)
    throw new McpCalendarError("too_large");
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
      throw new McpCalendarError("too_large");
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

/**
 * Reads the JSON object of a calendar request.
 *
 * @param request - The request with `Content-Type: application/json`.
 * @returns The object, its fields still untrusted; an empty body counts as `{}`.
 * @throws {McpCalendarError} `too_large` above 256 KiB, `invalid_request` for
 * another content type, malformed JSON or anything but an object.
 */
export async function readMcpCalendarBody(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  let text: string;
  try {
    text = await readLimitedText(request);
  } catch (error: unknown) {
    if (error instanceof McpCalendarError) throw error;
    throw new McpCalendarError("invalid_request");
  }
  if (text.trim() === "") return {};
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new McpCalendarError("invalid_request");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new McpCalendarError("invalid_request");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new McpCalendarError("invalid_request");
  return Object.fromEntries(Object.entries(body));
}

/**
 * Reads the query of a calendar request.
 *
 * @param request - The request.
 */
export function mcpCalendarQuery(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}
