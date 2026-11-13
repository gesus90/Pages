import { catalogModelChoice } from "@/definition/AgentModelChoice";
import { consumerModels } from "@/definition/AgentModelConsumers";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";
import { isDecisionModel } from "@/definition/ConversationDecision";

import { canUseAgentConnection } from "../agents/AgentConnectionAccess";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentModelSelection } from "@/definition/AgentModelSelection";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";
import type { PageAgentModel } from "@/definition/PageAgent";

/** The connection of the simulated decision model; never a stored connection. */
export const DECISION_SIMULATION_CONNECTION = "pages-decision-simulation";

/** The model name the simulated connection offers. */
export const DECISION_SIMULATION_MODEL = "simulation-decider";

/** Where the decision models are read from. */
export interface ChatDecisionModelSource {
  readonly connections: AgentConnectionRepository;
  /** Whether the development simulation offers its model. */
  readonly isSimulation: boolean;
}

// The shared choice hides models whose stated modalities rule out chatting;
// giving decisions is exactly what such a model is listed for here. The
// shared choice already marks it as a decision model.
function decisionChoice(
  connection: AgentConnectionRecord,
  model: AgentCatalogModel,
): PageAgentModel {
  return {
    ...catalogModelChoice(connection, model),
    isChatCapable: undefined,
    isDecisionCapable: true,
  };
}

async function openRouterEntries(
  connections: AgentConnectionRepository,
  connection: AgentConnectionRecord,
): Promise<readonly PageAgentModel[]> {
  const catalog = await connections.catalogs().find(connection.id);
  const failure = catalog.errorCode ? { isCatalogFailed: true } : {};
  return catalog.models
    .filter(isDecisionModel)
    .map((model) => ({ ...decisionChoice(connection, model), ...failure }));
}

function simulationEntry(): PageAgentModel {
  return {
    id: agentModelKey(
      DECISION_SIMULATION_CONNECTION,
      DECISION_SIMULATION_MODEL,
    ),
    connectionId: DECISION_SIMULATION_CONNECTION,
    name: "Simulation Decider",
    modelName: "Simulation Decider",
    connectionName: "Simulation",
    location: "local",
    model: DECISION_SIMULATION_MODEL,
    reasoning: "none",
    reasoningEfforts: [],
    catalogDefaultReasoningEffort: null,
    reasoningEffort: null,
    provider: "openrouter",
    isFree: true,
    isSimulation: true,
    isDecisionCapable: true,
  };
}

// Only OpenRouter's API gives decisions; CLI tools and other APIs give none.
function isDecisionConnection(connection: AgentConnectionRecord): boolean {
  return (
    connection.isActive &&
    connection.hasApiKey &&
    connection.provider === "openrouter"
  );
}

/**
 * Lists the decision models of the instance (PAGE-379).
 *
 * @param source - The stored connections and the simulation switch.
 * @param viewer - The administrator who chooses; `null` when Pages decides for
 * the instance, which no connection scope limits.
 * @returns The models the central rule of `decision` keeps, the simulation last.
 *
 * @remarks
 * Only a model whose stored OpenRouter catalog states `decisions` among its
 * outputs ({@link isDecisionModel}) is listed. No provider is called.
 */
export async function listDecisionModels(
  source: ChatDecisionModelSource,
  viewer: AgentViewer | null,
): Promise<readonly PageAgentModel[]> {
  const entries: PageAgentModel[] = [];
  for (const connection of await source.connections.list()) {
    if (!isDecisionConnection(connection)) continue;
    if (
      viewer !== null &&
      !(await canUseAgentConnection(source.connections, viewer, connection.id))
    )
      continue;
    entries.push(...(await openRouterEntries(source.connections, connection)));
  }
  if (source.isSimulation) entries.push(simulationEntry());
  return consumerModels("decision", entries);
}

/**
 * Finds the entry of a saved choice.
 *
 * @param models - The listed decision models.
 * @param selection - The saved choice; `null` without one.
 * @returns The model, or `null` when the choice is not listed.
 */
export function findDecisionModel(
  models: readonly PageAgentModel[],
  selection: AgentModelSelection | null,
): PageAgentModel | null {
  if (selection === null) return null;
  return (
    models.find(
      (entry) =>
        entry.connectionId === selection.connectionId &&
        entry.model === selection.model,
    ) ?? null
  );
}
