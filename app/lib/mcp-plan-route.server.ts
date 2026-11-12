import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
} from "@/app/lib/mcp-device-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { McpPlanApi } from "@/backend/service/mcp/plan/McpPlanApi";
import {
  McpPlanError,
  toMcpPlanError,
} from "@/backend/service/mcp/plan/McpPlanError";

import type {
  McpPlanOperation,
  McpPlanRequest,
} from "@/backend/service/mcp/plan/McpPlanApi";
import type { AgentIdentity } from "@/definition/McpAuthorization";

/** Largest JSON body of the plan API, as large as a plan the interface saves. */
const MAXIMUM_BODY_BYTES = 2_000_000;

/** Query parameters the operations read as whole numbers; every other one stays text. */
const NUMBER_QUERY_PARAMETERS: ReadonlySet<string> = new Set([
  "limit",
  "maxBytes",
  "after",
  "before",
  "version",
  "iteration",
]);

/** The methods the plan API serves. */
type McpPlanMethod = "GET" | "POST" | "PATCH";

/** Everything a handler of the plan API works with. */
export interface McpPlanCall {
  readonly api: McpPlanApi;
  readonly identity: AgentIdentity;
  readonly request: Request;
}

/** Answers one method of a plan resource. */
export type McpPlanHandler = (call: McpPlanCall) => Promise<Response>;

/** The handlers of one plan resource by method. */
export type McpPlanHandlers = Readonly<
  Partial<Record<McpPlanMethod, McpPlanHandler>>
>;

function isServedMethod(
  method: string,
  handlers: McpPlanHandlers,
): method is McpPlanMethod {
  return Object.hasOwn(handlers, method);
}

/** Creates the API over the plan operations of the `mcp` channel and the device token check. */
async function createApi(): Promise<McpPlanApi> {
  const services = await getApplicationServices();
  return new McpPlanApi(services.mcpPlanServices(), {
    devices: services.mcpDeviceService,
    accounts: services.userService,
  });
}

/**
 * Answers a plan request with JSON that no cache keeps.
 *
 * @param body - The `result` of the operation, unchanged.
 * @param status - The HTTP status: `201` after creating or cloning, `200` otherwise.
 */
export function mcpPlanResponse(body: unknown, status = 200): Response {
  return mcpDeviceResponse(body, status);
}

/**
 * Answers a failure of a plan request.
 *
 * @remarks
 * The body holds the code and, where the operation layer named one, its
 * `reason` as `detail`; never a message and never a part of the request.
 */
function mcpPlanFailure(error: unknown): Response {
  const failure = toMcpPlanError(error);
  if (failure === null) return mcpDeviceFailure(error);
  return mcpDeviceResponse(
    failure.detail === null
      ? { error: failure.code }
      : { error: failure.code, detail: failure.detail },
    failure.status,
    failure.retryAfterSeconds === null
      ? {}
      : { "Retry-After": String(failure.retryAfterSeconds) },
  );
}

/**
 * Runs one request of the plan API (PAGE-246).
 *
 * @param request - The request of the machine.
 * @param handlers - The methods the resource serves.
 * @returns The answer; a failure answers `{ "error": "<code>" }`, with a `detail` where the operation layer gave a reason.
 *
 * @remarks
 * Only the bearer token admits a request, checked and noted by the device
 * API exactly as for the ticket API; browser cookies play no part. Failures
 * of the token check keep the mapping of the device API, failures of the
 * plan operation layer become the codes of the plan interface.
 */
export async function runMcpPlanRoute(
  request: Request,
  handlers: McpPlanHandlers,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const handler = isServedMethod(method, handlers)
    ? handlers[method]
    : undefined;
  if (handler === undefined)
    return mcpDeviceMethodNotAllowed(Object.keys(handlers).join(", "));
  try {
    const api = await createApi();
    const identity = await api.authenticate(
      request.headers.get("Authorization"),
    );
    return await handler({ api, identity, request });
  } catch (error: unknown) {
    return mcpPlanFailure(error);
  }
}

/** Reads a request body as text, refusing more than the limit while it arrives. */
async function readLimitedText(request: Request): Promise<string> {
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAXIMUM_BODY_BYTES)
    throw new McpPlanError("too_large");
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
      throw new McpPlanError("too_large");
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

/**
 * Reads the JSON object of a plan request.
 *
 * @param request - The request with `Content-Type: application/json`.
 * @returns The object, its fields still untrusted; an empty body counts as `{}`.
 * @throws {McpPlanError} `too_large` for a body above 2,000,000 bytes,
 * `invalid_request` for another content type, malformed JSON or anything but an object.
 *
 * @remarks
 * A syntax error is replaced and not logged: the message of the parser can
 * quote the input.
 */
export async function readMcpPlanBody(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  let text: string;
  try {
    text = await readLimitedText(request);
  } catch (error: unknown) {
    if (error instanceof McpPlanError) throw error;
    throw new McpPlanError("invalid_request");
  }
  if (text.trim() === "") return {};
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new McpPlanError("invalid_request");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new McpPlanError("invalid_request");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new McpPlanError("invalid_request");
  return Object.fromEntries(Object.entries(body));
}

/**
 * Reads the query parameters of a plan request as the parameters of its operation.
 *
 * @param request - The `GET` request.
 * @returns One value per name; `limit` and `maxBytes` as whole numbers when they are written as such.
 * @throws {McpPlanError} `invalid_request` for a parameter named twice.
 *
 * @remarks
 * Which names an operation accepts and what their values may be is decided
 * by the input reader of the operation, not here.
 */
export function readMcpPlanQuery(
  request: Request,
): Readonly<Record<string, unknown>> {
  const query = new URL(request.url).searchParams;
  const parameters: Record<string, unknown> = {};
  for (const [name, value] of query) {
    if (Object.hasOwn(parameters, name))
      throw new McpPlanError("invalid_request");
    parameters[name] =
      NUMBER_QUERY_PARAMETERS.has(name) && /^\d{1,15}$/u.test(value)
        ? Number(value)
        : value;
  }
  return parameters;
}

/**
 * Reads a path parameter of a plan resource.
 *
 * @param value - The parameter as React Router passes it.
 * @throws {McpPlanError} `not_found` for a missing parameter.
 */
export function requireMcpPlanParameter(value: string | undefined): string {
  if (value === undefined || value.trim() === "")
    throw new McpPlanError("not_found");
  return value;
}

/**
 * Names the parameters of a call: the body of the request and the path parameters of its resource.
 *
 * @param request - The request with a JSON body.
 * @param path - The path parameters, already read.
 */
export async function mcpPlanBodyRequest(
  request: Request,
  path: Readonly<Record<string, string>> = {},
): Promise<McpPlanRequest> {
  return { parameters: await readMcpPlanBody(request), path };
}

/**
 * Names the parameters of a read: the query of the request and the path parameters of its resource.
 *
 * @param request - The `GET` request.
 * @param path - The path parameters, already read.
 */
export function mcpPlanQueryRequest(
  request: Request,
  path: Readonly<Record<string, string>> = {},
): McpPlanRequest {
  return { parameters: readMcpPlanQuery(request), path };
}

/**
 * The handlers of a resource that only reads one operation (PAGE-307).
 *
 * @param operation - The operation of the read.
 * @param path - Reads the path parameters of the resource, after the token check.
 * @returns A `GET` handler that answers the `result` of the operation unchanged.
 */
export function mcpPlanReadHandlers(
  operation: McpPlanOperation,
  path: () => Readonly<Record<string, string>>,
): McpPlanHandlers {
  return {
    GET: async ({ api, identity, request }) =>
      mcpPlanResponse(
        await api.run(
          identity,
          operation,
          mcpPlanQueryRequest(request, path()),
        ),
      ),
  };
}
