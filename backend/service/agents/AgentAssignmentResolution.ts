import { isInAgentConnectionScope } from "@/backend/auth/AgentConnectionScopePolicy";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { isApiProvider } from "@/definition/AgentConnection";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type { TextAgentRole } from "@/definition/TextAssistant";

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
  assignment: TextAgentRole,
): Promise<ResolvedAgentAssignment> {
  const connection = await connections.find(assignment.connectionId);
  if (
    !connection ||
    !connection.isActive ||
    (isApiProvider(connection.provider)
      ? !connection.hasApiKey
      : connection.cliLoggedInAt === null)
  )
    throw new TextAssistantError("connectionUnavailable");
  if (isApiProvider(connection.provider)) {
    const auth = await connections.checks().find(connection.id, "auth");
    if (auth?.status !== "passed")
      throw new TextAssistantError("accessUnverified");
  }
  const catalog = await connections.catalogs().find(connection.id);
  const model = catalog.models.find((entry) => entry.id === assignment.model);
  if (!model) throw new TextAssistantError("modelUnavailable");
  const effort = assignment.reasoningEffort;
  if (
    effort === null
      ? model.reasoningEfforts.length > 0
      : !model.reasoningEfforts.includes(effort)
  )
    throw new TextAssistantError("reasoningUnsupported");
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
 * @throws {TextAssistantError} `accessDenied` when the scope excludes the person.
 *
 * @remarks
 * The scope comes first, so a person outside it learns nothing about the state
 * of the connection. A missing connection passes here and fails as unavailable.
 */
export async function resolveAgentAssignmentFor(
  connections: AgentConnectionRepository,
  viewer: AgentViewer,
  assignment: TextAgentRole,
): Promise<ResolvedAgentAssignment> {
  const scope = await connections.scopes().find(assignment.connectionId);
  if (scope !== null && !isInAgentConnectionScope(scope, viewer))
    throw new TextAssistantError("accessDenied");
  return resolveAgentAssignment(connections, assignment);
}
