import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { isApiProvider } from "@/definition/AgentConnection";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { TextAgentRole } from "@/definition/TextAssistant";

/** Immutable metadata resolved once at request start, without credentials. */
export interface ResolvedAgentAssignment {
  readonly connection: AgentConnectionRecord;
  readonly model: string;
  readonly reasoningEffort: string | null;
}

/** Requires verified access and capabilities from exactly the referenced connection. */
export async function resolveAgentAssignment(
  connections: AgentConnectionRepository,
  assignment: TextAgentRole,
): Promise<ResolvedAgentAssignment> {
  const connection = await connections.find(assignment.connectionId);
  if (
    !connection ||
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
