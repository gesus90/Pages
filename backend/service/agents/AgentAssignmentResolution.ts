import { isInAgentConnectionScope } from "@/backend/auth/AgentConnectionScopePolicy";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { isApiProvider } from "@/definition/AgentConnection";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type { AgentModelSelection } from "@/definition/AgentModelSelection";

/** Immutable metadata resolved once at request start, without credentials. */
export interface ResolvedAgentAssignment {
  readonly connection: AgentConnectionRecord;
  readonly model: string;
  readonly reasoningEffort: string | null;
  /**
   * The run options the administration stored with the assigned agent;
   * absent where the agent names none or the caller resolved a bare role.
   */
  readonly run?: AgentRunOptions;
}

/** Requires verified access and capabilities from exactly the referenced connection. */
export async function resolveAgentAssignment(
  connections: AgentConnectionRepository,
  assignment: AgentModelSelection,
): Promise<ResolvedAgentAssignment> {
  const connection = await connections.find(assignment.connectionId);
  if (
    !connection ||
    !connection.isActive ||
    (isApiProvider(connection.provider)
      ? !connection.hasApiKey
      : connection.cliLoggedInAt === null)
  )
    throw new AgentExecutionError("connectionUnavailable");
  if (isApiProvider(connection.provider)) {
    const auth = await connections.checks().find(connection.id, "auth");
    if (auth?.status !== "passed")
      throw new AgentExecutionError("accessUnverified");
  }
  const catalog = await connections.catalogs().find(connection.id);
  const model = catalog.models.find((entry) => entry.id === assignment.model);
  if (!model) throw new AgentExecutionError("modelUnavailable");
  const effort = assignment.reasoningEffort;
  if (
    effort === null
      ? model.reasoningEfforts.length > 0
      : !model.reasoningEfforts.includes(effort)
  )
    throw new AgentExecutionError("reasoningUnsupported");
  return {
    connection: { ...connection },
    model: assignment.model,
    reasoningEffort: effort,
  };
}

/**
 * Resolves an assignment for one person, after the connection scope admits them.
 *
 * @param connections - Connection persistence.
 * @param viewer - Current account facts and group memberships of the person.
 * @param assignment - The role or profile naming connection, model and effort.
 * @returns The resolved assignment, as {@link resolveAgentAssignment} does.
 * @throws {AgentExecutionError} `accessDenied` when the scope excludes the person.
 *
 * @remarks
 * The scope comes first, so a person outside it learns nothing about the state
 * of the connection. A missing connection passes here and fails as unavailable.
 */
export async function resolveAgentAssignmentFor(
  connections: AgentConnectionRepository,
  viewer: AgentViewer,
  assignment: AgentModelSelection,
): Promise<ResolvedAgentAssignment> {
  const scope = await connections.scopes().find(assignment.connectionId);
  if (scope !== null && !isInAgentConnectionScope(scope, viewer))
    throw new AgentExecutionError("accessDenied");
  return resolveAgentAssignment(connections, assignment);
}
