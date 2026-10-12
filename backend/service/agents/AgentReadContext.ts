import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { createAgentTaskContext } from "./AgentTaskAccess";

import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type { Database } from "@/backend/database/Database";
import type { UserService } from "@/backend/service/UserService";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { AgentTaskContext } from "./AgentTaskAccess";

/** The server-owned collaborators of reads that run with the account of a verified credential. */
export interface AgentReadDependencies {
  readonly database: Database;
  readonly users: Pick<UserService, "getById">;
  /** The agent surface the reads run for; MCP when absent. */
  readonly channel?: AgentChannel;
}

/**
 * Resolves the account of a verified credential anew and binds the ticket
 * services to it.
 *
 * @param dependencies - The database, the account lookup and the agent surface.
 * @param identity - The verified owner of the call.
 * @returns The ticket and project services for this one call.
 * @throws {McpAuthorizationError} `invalid_token` when the account is inactive or must change its password.
 */
export async function createAgentReadContext(
  dependencies: AgentReadDependencies,
  identity: AgentIdentity,
): Promise<AgentTaskContext> {
  const actor = await dependencies.users.getById(identity.userId);
  if (!actor?.isActive || actor.mustChangePassword)
    throw new McpAuthorizationError("invalid_token", 401);
  return createAgentTaskContext(
    dependencies.database,
    actor,
    dependencies.channel,
  );
}

/**
 * Wraps a read result in the version-one envelope within the response budget.
 *
 * @param result - What the read produced.
 * @returns The envelope.
 * @throws {AgentOperationError} `PAYLOAD_TOO_LARGE` when the serialized response exceeds the limit.
 */
export function respondAgentRead(
  result: PagesAgentReadResponse["result"],
): PagesAgentReadResponse {
  const response: PagesAgentReadResponse = { apiVersion: "1", result };
  if (
    Buffer.byteLength(JSON.stringify(response)) >
    PAGES_AGENT_LIMITS.responseBytes
  )
    throw new AgentOperationError("PAYLOAD_TOO_LARGE");
  return response;
}
