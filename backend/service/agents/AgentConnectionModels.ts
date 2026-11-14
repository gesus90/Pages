import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { catalogModelChoice } from "@/definition/AgentModelChoice";
import { supportsModelCatalog } from "@/definition/AgentModelCatalog";

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
    const models = selectionModels(connection, catalog.models);
    // Every model in this catalog shares the same connection grant and authentication.
    // Check those once per request, rather than repeating database reads for every model.
    if (!(await isAvailable({ connections, viewer, connection, models })))
      continue;
    // A failed last refresh keeps the stored models; the choice warns about them.
    const failure = catalog.errorCode ? { isCatalogFailed: true } : {};
    for (const model of models)
      choices.push({ ...catalogModelChoice(connection, model), ...failure });
  }
  return choices;
}

function selectionModels(
  connection: AgentConnectionRecord,
  models: readonly AgentCatalogModel[],
): readonly AgentCatalogModel[] {
  if (
    !supportsModelCatalog(connection.provider) ||
    (connection.provider === "zai" && models.length === 0)
  )
    return manualModels(connection);
  return connection.provider === "opencode"
    ? models.filter((model) => model.id.startsWith("opencode/") && model.isFree)
    : models;
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

async function isAvailable(input: {
  readonly connections: AgentConnectionRepository;
  readonly viewer: AgentViewer;
  readonly connection: AgentConnectionRecord;
  readonly models: readonly AgentCatalogModel[];
}): Promise<boolean> {
  const { connections, viewer, connection, models } = input;
  const model = models.at(0);
  if (!model) return false;
  try {
    await resolveAgentAssignmentFor(connections, viewer, {
      connectionId: connection.id,
      model: model.id,
      reasoningEffort: null,
    });
    return true;
  } catch (error: unknown) {
    if (!(error instanceof AgentExecutionError)) throw error;
    return false;
  }
}
