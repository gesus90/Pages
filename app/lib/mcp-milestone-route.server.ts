import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
} from "@/app/lib/mcp-device-response.server";
import {
  readMcpPlanBody,
  readMcpPlanQuery,
} from "@/app/lib/mcp-plan-route.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { McpMilestoneApi } from "@/backend/service/mcp/milestone/McpMilestoneApi";
import { toMcpPlanError } from "@/backend/service/mcp/plan/McpPlanError";

import type {
  McpMilestoneOperation,
  McpMilestoneRequest,
} from "@/backend/service/mcp/milestone/McpMilestoneApi";
import type { AgentIdentity } from "@/definition/McpAuthorization";

/** The methods the milestone API serves. */
type McpMilestoneMethod = "GET" | "POST" | "PATCH";

/** Everything a handler of the milestone API works with. */
export interface McpMilestoneCall {
  readonly api: McpMilestoneApi;
  readonly identity: AgentIdentity;
  readonly request: Request;
}

/** Answers one method of a milestone resource. */
export type McpMilestoneHandler = (call: McpMilestoneCall) => Promise<Response>;

/** The handlers of one milestone resource by method. */
export type McpMilestoneHandlers = Readonly<
  Partial<Record<McpMilestoneMethod, McpMilestoneHandler>>
>;

/** Reads the path parameters of a resource; called after the token check. */
export type McpMilestonePath = () => Readonly<Record<string, string>>;

function isServedMethod(
  method: string,
  handlers: McpMilestoneHandlers,
): method is McpMilestoneMethod {
  return Object.hasOwn(handlers, method);
}

/** Creates the API over the agent operations of the `mcp` channel and the device token check. */
async function createApi(): Promise<McpMilestoneApi> {
  const services = await getApplicationServices();
  return new McpMilestoneApi(services.mcpMilestoneServices, {
    devices: services.mcpDeviceService,
    accounts: services.userService,
  });
}

/**
 * Answers a failure of a request that runs an agent operation, such as a
 * milestone change or the source search.
 * @param error - The error of the request.
 * @returns The answer with `{ error }`, `Retry-After` for a limit.
 * @remarks
 * A refusal of the operation layer keeps its code, such as `NOT_FOUND`,
 * `FORBIDDEN` or `CONFLICT`, with the details the layer names; a failure of
 * the token check or of reading the body keeps the code of the device and
 * plan interfaces. Never a message and never a part of the request.
 */
export function mcpOperationFailure(error: unknown): Response {
  if (error instanceof AgentOperationError)
    return mcpDeviceResponse(
      { error: error.code, ...error.details },
      error.status,
    );
  const failure = toMcpPlanError(error);
  if (failure === null) return mcpDeviceFailure(error);
  return mcpDeviceResponse(
    { error: failure.code },
    failure.status,
    failure.retryAfterSeconds === null
      ? {}
      : { "Retry-After": String(failure.retryAfterSeconds) },
  );
}

/**
 * Runs one request of the milestone API.
 * @param request - The request of the machine.
 * @param handlers - The methods the resource serves.
 * @returns The answer; a failure answers `{ "error": "<code>" }`.
 * @remarks
 * Only the bearer token admits a request, checked and noted by the device
 * API exactly as for the ticket and plan APIs; browser cookies play no part.
 */
export async function runMcpMilestoneRoute(
  request: Request,
  handlers: McpMilestoneHandlers,
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
    return mcpOperationFailure(error);
  }
}

/**
 * Reads a path parameter of a milestone resource.
 * @param value - The parameter as React Router passes it.
 * @throws {AgentOperationError} `NOT_FOUND` for a missing parameter.
 */
export function requireMcpMilestoneParameter(
  value: string | undefined,
): string {
  if (value === undefined || value.trim() === "")
    throw new AgentOperationError("NOT_FOUND");
  return value;
}

/**
 * Names the parameters of a change: the JSON body and the path parameters.
 * @param request - The request with a JSON body.
 * @param path - Reads the path parameters of the resource.
 */
export async function mcpMilestoneBodyRequest(
  request: Request,
  path: McpMilestonePath,
): Promise<McpMilestoneRequest> {
  return { parameters: await readMcpPlanBody(request), path: path() };
}

/**
 * The handler of a resource that runs one milestone write with the body of the request.
 * @param operation - The operation of the endpoint.
 * @param path - Reads the path parameters of the resource, after the token check.
 * @param status - The HTTP status of a success: `201` after creating, `200` otherwise.
 * @returns A handler that answers the `result` of the operation unchanged.
 */
export function mcpMilestoneWrite(
  operation: McpMilestoneOperation,
  path: McpMilestonePath,
  status = 200,
): McpMilestoneHandler {
  return async ({ api, identity, request }) =>
    mcpDeviceResponse(
      await api.run(
        identity,
        operation,
        await mcpMilestoneBodyRequest(request, path),
      ),
      status,
    );
}

/**
 * The handler that reads the milestones of a project with the query of the request.
 * @param path - Reads the `projectId` of the resource, after the token check.
 * @returns A handler that answers the `result` of `milestones.read` unchanged.
 */
export function mcpMilestoneRead(path: McpMilestonePath): McpMilestoneHandler {
  return async ({ api, identity, request }) =>
    mcpDeviceResponse(
      await api.run(identity, "milestones.read", {
        parameters: readMcpPlanQuery(request),
        path: path(),
      }),
    );
}
