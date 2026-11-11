import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
} from "@/app/lib/mcp-device-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { DatabaseExecutorError } from "@/backend/database/executor/DatabaseExecutorErrors";
import { AutomationError } from "@/backend/error/AutomationError";
import { McpDeviceError } from "@/backend/error/McpDeviceError";

import type { AutomationService } from "@/backend/service/automation/AutomationService";

/** Largest JSON body: a script of 100,000 characters with room for its definition. */
const MAXIMUM_BODY_BYTES = 1_000_000;
/** Seconds after which a request that met an unavailable database may be repeated. */
const RETRY_AFTER_SECONDS = 5;

/** The methods the automation API serves. */
type McpAutomationMethod = "GET" | "POST" | "PATCH";

/** Everything a handler of the automation API works with. */
export interface McpAutomationCall {
  readonly automations: AutomationService;
  /** The paired account; every call acts with its current rights. */
  readonly userId: string;
  readonly request: Request;
}

/** Answers one method of an automation resource. */
export type McpAutomationHandler = (
  call: McpAutomationCall,
) => Promise<Response>;

/** The handlers of one automation resource by method. */
export type McpAutomationHandlers = Readonly<
  Partial<Record<McpAutomationMethod, McpAutomationHandler>>
>;

function isServedMethod(
  method: string,
  handlers: McpAutomationHandlers,
): method is McpAutomationMethod {
  return Object.hasOwn(handlers, method);
}

/** Checks the device token and names the paired account it acts for. */
async function authenticate(request: Request): Promise<{
  readonly automations: AutomationService;
  readonly userId: string;
}> {
  const services = await getApplicationServices();
  const identity = await services.mcpDeviceService.authenticate(
    request.headers.get("Authorization"),
  );
  const credentials = await services.userService.findCredentialsByUsername(
    identity.account.username,
  );
  const account = credentials?.user ?? null;
  if (account === null || !account.isActive)
    throw new McpDeviceError("invalid_token", 401);
  return { automations: services.automationService, userId: account.id };
}

/**
 * Answers an automation request with JSON that no cache keeps.
 *
 * @param body - The result of the operation, unchanged.
 * @param status - `201` after creating, `200` otherwise.
 */
export function mcpAutomationResponse(body: unknown, status = 200): Response {
  return mcpDeviceResponse(body, status);
}

/**
 * Answers a failure with the fixed codes of the MCP HTTP conventions.
 *
 * @remarks
 * The body holds the code, the stable `detail` reason, `currentRevision` on
 * a conflict and the paths of refused input; never values, never data of a
 * scope the account cannot see.
 */
function mcpAutomationFailure(error: unknown): Response {
  if (error instanceof AutomationError)
    return mcpDeviceResponse(
      {
        error: error.code,
        ...(error.reason ? { detail: error.reason } : {}),
        ...(error.currentRevision === null
          ? {}
          : { currentRevision: error.currentRevision }),
        ...(error.problems.length > 0 ? { problems: error.problems } : {}),
      },
      error.status,
      error.code === "server_unavailable" || error.code === "rate_limited"
        ? { "Retry-After": String(RETRY_AFTER_SECONDS) }
        : {},
    );
  if (error instanceof DatabaseExecutorError)
    return mcpDeviceResponse({ error: "server_unavailable" }, 503, {
      "Retry-After": String(RETRY_AFTER_SECONDS),
    });
  if (error instanceof McpDeviceError && error.code === "slow_down")
    return mcpDeviceResponse({ error: "rate_limited" }, 429, {
      "Retry-After": String(error.retryAfterSeconds ?? RETRY_AFTER_SECONDS),
    });
  return mcpDeviceFailure(error);
}

/**
 * Runs one request of the automation API (PAGE-297).
 *
 * @param request - The request of the paired machine.
 * @param handlers - The methods the resource serves.
 *
 * @remarks
 * Only the device token of the existing pairing admits a request, with the
 * account it was paired for; browser cookies play no part. The same
 * automation service as the page, Pica and the agent tools answers.
 */
export async function runMcpAutomationRoute(
  request: Request,
  handlers: McpAutomationHandlers,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const handler = isServedMethod(method, handlers)
    ? handlers[method]
    : undefined;
  if (handler === undefined)
    return mcpDeviceMethodNotAllowed(Object.keys(handlers).join(", "));
  try {
    const { automations, userId } = await authenticate(request);
    return await handler({ automations, userId, request });
  } catch (error: unknown) {
    return mcpAutomationFailure(error);
  }
}

async function readLimitedText(request: Request): Promise<string> {
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > MAXIMUM_BODY_BYTES)
    throw new AutomationError("too_large");
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
      throw new AutomationError("too_large");
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

function withPath(
  parameters: Readonly<Record<string, unknown>>,
  path: Readonly<Record<string, string>>,
): Readonly<Record<string, unknown>> {
  for (const key of Object.keys(path))
    if (Object.hasOwn(parameters, key))
      throw new AutomationError("invalid_request", {
        reason: "validation",
        problems: [`${key}: given in the path`],
      });
  return { ...parameters, ...path };
}

/**
 * Reads the JSON body of a request together with its path parameters.
 *
 * @throws {AutomationError} `too_large` above 1,000,000 bytes, `invalid_request`
 * for another content type, malformed JSON, anything but an object or a path
 * parameter repeated in the body.
 */
export async function readMcpAutomationBody(
  request: Request,
  path: Readonly<Record<string, string>> = {},
): Promise<Readonly<Record<string, unknown>>> {
  let text: string;
  try {
    text = await readLimitedText(request);
  } catch (error: unknown) {
    if (error instanceof AutomationError) throw error;
    throw new AutomationError("invalid_request");
  }
  if (text.trim() === "") return withPath({}, path);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AutomationError("invalid_request");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AutomationError("invalid_request");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new AutomationError("invalid_request");
  return withPath(Object.fromEntries(Object.entries(body)), path);
}

/**
 * Reads the query of a `GET` request together with its path parameters.
 *
 * @remarks
 * `limit` becomes a whole number and `isActive` a boolean when written as
 * such; the operation decides what else is allowed.
 */
export function readMcpAutomationQuery(
  request: Request,
  path: Readonly<Record<string, string>> = {},
): Readonly<Record<string, unknown>> {
  const query = new URL(request.url).searchParams;
  const parameters: Record<string, unknown> = {};
  for (const [name, value] of query) {
    if (Object.hasOwn(parameters, name))
      throw new AutomationError("invalid_request");
    if (name === "limit" && /^\d{1,6}$/u.test(value))
      parameters[name] = Number(value);
    else if (name === "isActive" && (value === "true" || value === "false"))
      parameters[name] = value === "true";
    else parameters[name] = value;
  }
  return withPath(parameters, path);
}

/**
 * Reads a path parameter of an automation resource.
 *
 * @throws {AutomationError} `not_found` for a missing parameter.
 */
export function requireMcpAutomationParameter(
  value: string | undefined,
): string {
  if (value === undefined || value.trim() === "")
    throw new AutomationError("not_found");
  return value;
}
