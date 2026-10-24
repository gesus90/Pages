import { isInAgentConnectionScope } from "@/backend/auth/AgentConnectionScopePolicy";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { isApiProvider } from "@/definition/AgentConnection";
import { supportsModelCatalog } from "@/definition/AgentModelCatalog";
import { resolveClaudeModelAlias } from "@/definition/AgentModelVersion";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
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

/**
 * Finds the catalog entry a stored model value names.
 *
 * @remarks
 * The exact ID wins. A Claude CLI connection also accepts the alias an earlier
 * version of Pages stored, such as `sonnet`, when its catalog says which one
 * model the CLI's picker resolves it to; the run then names that concrete
 * version. Any other value stays unknown, so no run switches to a model
 * nobody chose.
 */
function findCatalogModel(
  connection: AgentConnectionRecord,
  models: readonly AgentCatalogModel[],
  stored: string,
): AgentCatalogModel | undefined {
  const exact = models.find((entry) => entry.id === stored);
  if (exact || connection.provider !== "claude_code") return exact;
  const resolved = resolveClaudeModelAlias(
    stored,
    models.map((entry) => ({ id: entry.id, aliases: entry.aliases })),
  );
  return models.find((entry) => entry.id === resolved);
}

async function requireVerifiedConnection(
  connections: AgentConnectionRepository,
  connectionId: string,
): Promise<AgentConnectionRecord> {
  const connection = await connections.find(connectionId);
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
  return connection;
}

/**
 * Requires verified access and capabilities from exactly the referenced connection.
 *
 * @param connections - Connection persistence.
 * @param assignment - Connection, model and effort a role, profile or node stored.
 * @returns The connection with the concrete model of its catalog: the stored
 * ID, or the version a stored Claude family alias resolves to.
 * @throws {AgentExecutionError} When the connection, its access, the model or
 * the effort is not available; the caller never gets another model.
 */
export async function resolveAgentAssignment(
  connections: AgentConnectionRepository,
  assignment: AgentModelSelection,
): Promise<ResolvedAgentAssignment> {
  const connection = await requireVerifiedConnection(
    connections,
    assignment.connectionId,
  );
  const catalog = await connections.catalogs().find(connection.id);
  const model = findCatalogModel(connection, catalog.models, assignment.model);
  const isManual =
    !supportsModelCatalog(connection.provider) &&
    connection.testModel === assignment.model;
  if (!model && !isManual) throw new AgentExecutionError("modelUnavailable");
  const effort = assignment.reasoningEffort;
  if (effort !== null && !model?.reasoningEfforts.includes(effort))
    throw new AgentExecutionError("reasoningUnsupported");
  return {
    connection: { ...connection },
    model: model?.id ?? assignment.model,
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
