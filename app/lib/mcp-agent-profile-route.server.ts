import {
  mcpDeviceFailure,
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
} from "@/app/lib/mcp-device-response.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { AgentProfileError } from "@/backend/error/AgentProfileError";
import { McpAgentError } from "@/backend/service/mcp/agent/McpAgentError";
import {
  McpAgentProfileApi,
  profileFailure,
} from "@/backend/service/mcp/agent/McpAgentProfileApi";

import type { McpAgentProfileActor } from "@/backend/service/mcp/agent/McpAgentProfileApi";

/** Largest answer of the profile reads: 1 MiB, larger results continue with `cursor`. */
const MAXIMUM_RESPONSE_BYTES = 1024 * 1024;

/** Everything a handler of the profile reads works with. */
export interface McpAgentProfileCall {
  readonly api: McpAgentProfileApi;
  readonly actor: McpAgentProfileActor;
  readonly request: Request;
}

/** Computes the answer of a profile read. */
export type McpAgentProfileHandler = (
  call: McpAgentProfileCall,
) => Promise<unknown>;

/**
 * Whether a request asks for the administration view of the old agent routes.
 *
 * @param request - The request.
 *
 * @remarks
 * The paths of the profile reads (PAGE-308) are those of the administration
 * of agents (PAGE-267, PAGE-280). The administration view stays reachable
 * with `?view=administration`; without it a `GET` answers the profile.
 */
export function isAdministrationView(request: Request): boolean {
  return new URL(request.url).searchParams.get("view") === "administration";
}

/**
 * The query of an administration view request without the `view` switch.
 *
 * @param request - The request.
 */
export function administrationQuery(request: Request): URLSearchParams {
  const query = new URL(request.url).searchParams;
  query.delete("view");
  return query;
}

/** Creates the API over the shared profile service and the device token check. */
async function createApi(): Promise<McpAgentProfileApi> {
  const services = await getApplicationServices();
  return new McpAgentProfileApi({
    accounts: services.userService,
    devices: services.mcpDeviceService,
    profiles: services.agentProfileReadService,
  });
}

/** Answers a failure with the fixed body of the interface; never a detail. */
function failure(error: unknown): Response {
  const profile = profileFailure(error);
  if (profile !== null) return mcpDeviceResponse(profile.body, profile.status);
  if (error instanceof McpAgentError)
    return mcpDeviceResponse({ error: error.code }, error.status);
  return mcpDeviceFailure(error);
}

/**
 * Runs one profile read (PAGE-308) as a `GET` with the device token.
 *
 * @param request - The request of the machine.
 * @param handler - Computes the answer from the actor and the request.
 * @returns The answer; a failure answers `{ "error": "<code>" }`, with `reason` for `invalid_request`.
 *
 * @remarks
 * Only the bearer token of a paired machine admits a request. The rights of
 * the account are decided again on every call by the service the user
 * interface reads through.
 */
export async function runMcpAgentProfileRoute(
  request: Request,
  handler: McpAgentProfileHandler,
): Promise<Response> {
  if (request.method.toUpperCase() !== "GET")
    return mcpDeviceMethodNotAllowed("GET");
  try {
    const api = await createApi();
    const actor = await api.authenticate(request.headers.get("Authorization"));
    const body = await handler({ api, actor, request });
    const json = JSON.stringify(body);
    if (Buffer.byteLength(json, "utf8") > MAXIMUM_RESPONSE_BYTES)
      throw new AgentProfileError("payload_too_large");
    return mcpDeviceResponse(body);
  } catch (error: unknown) {
    return failure(error);
  }
}
