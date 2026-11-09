import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
} from "@/app/lib/mcp-device-response.server";
import { readMcpWorkspaceBody } from "@/app/lib/mcp-workspace-route.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  McpUserError,
  toMcpUserError,
} from "@/backend/service/mcp/users/McpUserError";

import type { McpUserApi } from "@/backend/service/mcp/users/McpUserApi";
import type { WikiService } from "@/backend/service/WikiService";
import type { McpUserChangeResponse } from "@/backend/service/mcp/users/McpUserContract";
import type { User } from "@/definition/User";

/** Longest body of the user management API; its bodies hold a few hundred references at most. */
const MAXIMUM_BODY_CHARACTERS = 64 * 1024;

/** The methods the user management API serves. */
type McpUserMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Everything a handler of the user management API works with. */
export interface McpUserCall {
  readonly api: McpUserApi;
  readonly actor: User;
  readonly request: Request;
  /** The wiki service of the interface, for the placeholders of private pages. */
  readonly wiki: WikiService;
}

/** Answers one method of a user management resource. */
export type McpUserHandler = (call: McpUserCall) => Promise<Response>;

/** The handlers of one resource by method. */
export type McpUserHandlers = Readonly<
  Partial<Record<McpUserMethod, McpUserHandler>>
>;

function isServedMethod(
  method: string,
  handlers: McpUserHandlers,
): method is McpUserMethod {
  return Object.hasOwn(handlers, method);
}

/**
 * Answers a user management request with JSON that no cache keeps.
 *
 * @param body - The answer of the interface.
 * @param status - The HTTP status.
 *
 * @remarks
 * `Cache-Control: no-store` matters most for the one answer that holds a
 * temporary password.
 */
export function mcpUserResponse(body: unknown, status = 200): Response {
  return mcpDeviceResponse(body, status);
}

/**
 * Answers a change: `201` for the first answer of a creation, `200` otherwise.
 *
 * @param answer - The result of `McpUserApi.change`.
 * @param isCreation - Whether the request creates an object.
 */
export function mcpUserChangeResponse(
  answer: McpUserChangeResponse,
  isCreation = false,
): Response {
  return mcpUserResponse(answer, isCreation && !answer.replayed ? 201 : 200);
}

/**
 * Runs one request of the user management API (PAGE-280).
 *
 * @param request - The request of the machine.
 * @param handlers - The methods the resource serves.
 * @returns The answer; a failure answers `{ "error": "<code>" }`, with
 * `confirmation` for `confirmation_required`.
 *
 * @remarks
 * Only the bearer token of a paired machine admits a request; browser
 * cookies play no part. Rights are read again on every call, inside the
 * transaction of the call. Nothing of the request and no message of a
 * service is part of a failure.
 */
export async function runMcpUserRoute(
  request: Request,
  handlers: McpUserHandlers,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const handler = isServedMethod(method, handlers)
    ? handlers[method]
    : undefined;
  if (handler === undefined)
    return mcpDeviceMethodNotAllowed(Object.keys(handlers).join(", "));
  try {
    const services = await getApplicationServices();
    const api = services.mcpUserApi;
    const actor = await api.authenticate(request.headers.get("Authorization"));
    return await handler({ api, actor, request, wiki: services.wikiService });
  } catch (error: unknown) {
    const failure = toMcpUserError(error);
    if (failure === null) return mcpDeviceFailure(error);
    return mcpUserResponse(failure.toBody(), failure.status);
  }
}

/**
 * Reads the JSON object of a user management request.
 *
 * @param request - The request with `Content-Type: application/json`.
 * @returns The object, its fields still untrusted; an empty body counts as `{}`.
 */
export async function readMcpUserBody(
  request: Request,
): Promise<Readonly<Record<string, unknown>>> {
  return readMcpWorkspaceBody(request, MAXIMUM_BODY_CHARACTERS);
}

/**
 * Reads a path parameter of a user management resource.
 *
 * @param value - The parameter as React Router passes it.
 * @throws {McpUserError} `not_found` for a missing parameter.
 */
export function requireMcpUserParameter(value: string | undefined): string {
  if (value === undefined || value.trim() === "")
    throw new McpUserError("not_found");
  return value;
}

/**
 * Reads the query of a request.
 *
 * @param request - The request.
 */
export function mcpUserQuery(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}
