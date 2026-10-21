import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { supportsModelCatalog } from "@/definition/AgentModelCatalog";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";

import { resolveAgentAssignmentFor } from "./AgentAssignmentResolution";
import { canUseAgentConnection } from "./AgentConnectionAccess";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type { PageAgentModel } from "@/definition/PageAgent";

/** Reads known models only; authentication and catalogs are never refreshed by selection. */
export async function connectionModels(
  connections: AgentConnectionRepository,
  viewer: AgentViewer,
): Promise<readonly PageAgentModel[]> {
  const choices: PageAgentModel[] = [];
  for (const connection of await connections.list()) {
    if (!(await canUseAgentConnection(connections, viewer, connection.id)))
      continue;
    const catalog = await connections.catalogs().find(connection.id);
    const models = supportsModelCatalog(connection.provider)
      ? catalog.models
      : manualModels(connection);
    for (const model of models) {
      const choice = await availableModel({
        connections,
        viewer,
        connection,
        model,
      });
      if (choice) choices.push(choice);
    }
  }
  return choices;
}

function manualModels(
  connection: AgentConnectionRecord,
): readonly AgentCatalogModel[] {
  if (!connection.testModel) return [];
  return [
    {
      id: connection.testModel,
      name: connection.testModel,
      contextWindow: null,
      promptPrice: null,
      completionPrice: null,
      isFree: false,
      reasoning: "unknown",
      reasoningEfforts: [],
      defaultReasoningEffort: null,
    },
  ];
}

async function availableModel(input: {
  readonly connections: AgentConnectionRepository;
  readonly viewer: AgentViewer;
  readonly connection: AgentConnectionRecord;
  readonly model: AgentCatalogModel;
}): Promise<PageAgentModel | null> {
  const { connections, viewer, connection, model } = input;
  try {
    await resolveAgentAssignmentFor(connections, viewer, {
      connectionId: connection.id,
      model: model.id,
      reasoningEffort: null,
    });
    return {
      id: agentModelKey(connection.id, model.id),
      connectionId: connection.id,
      name: `${model.name} · ${connection.name}`,
      model: model.id,
      provider: connection.provider,
      reasoning: model.reasoning,
      reasoningEfforts: model.reasoningEfforts,
      catalogDefaultReasoningEffort: model.defaultReasoningEffort,
      reasoningEffort: null,
      isManual: !supportsModelCatalog(connection.provider),
    };
  } catch (error: unknown) {
    if (!(error instanceof AgentExecutionError)) throw error;
    return null;
  }
}
