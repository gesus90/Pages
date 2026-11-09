import { agentModelKey } from "@/definition/AgentPlanConfiguration";
import {
  AGENT_SIMULATION_CONNECTIONS,
  AGENT_SIMULATION_MODEL,
  agentSimulationRunner,
} from "@/definition/AgentSimulation";
import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { AgentSimulationMode } from "./AgentSimulationMode";

// The simulation answers like a request to an API connection: no tools, no
// process. The provider only selects that execution path; no request leaves.
const PROVIDER = "openrouter";

const NAMES = {
  local: "Simulation",
  remote: "Simulation · Remote-Runner",
} as const;

function simulationModel(runner: "local" | "remote"): PageAgentModel {
  const connectionId = AGENT_SIMULATION_CONNECTIONS[runner];
  return {
    id: agentModelKey(connectionId, AGENT_SIMULATION_MODEL),
    connectionId,
    name: NAMES[runner],
    modelName: NAMES[runner],
    connectionName: "Simulation",
    location: runner,
    model: AGENT_SIMULATION_MODEL,
    reasoning: "none",
    reasoningEfforts: [],
    catalogDefaultReasoningEffort: null,
    reasoningEffort: null,
    provider: PROVIDER,
    isFree: true,
    isToolCapable: false,
    isSimulation: true,
    ...(runner === "remote" ? { targetName: "Simulation" } : {}),
  };
}

/** The models the simulation offers to plan nodes; none while it is off. */
export function agentSimulationModels(
  mode: AgentSimulationMode | undefined,
): readonly PageAgentModel[] {
  return mode?.isActive
    ? [simulationModel("local"), simulationModel("remote")]
    : [];
}

function simulationConnection(
  runner: "local" | "remote",
): AgentConnectionRecord {
  return {
    isActive: true,
    id: AGENT_SIMULATION_CONNECTIONS[runner],
    name: NAMES[runner],
    provider: PROVIDER,
    hasApiKey: false,
    testModel: null,
    reasoningEffort: null,
    cliLoggedInAt: null,
    cliAccountLabel: null,
    updatedAt: "1970-01-01 00:00:00",
  };
}

/**
 * The assignment of a node that chose a simulation model.
 *
 * @returns `null` for every real connection.
 * @throws {AgentError} `connection_not_found` when the node chose the
 * simulation but it is off, as in production: the node then names its
 * model as unavailable and never falls back to a real model.
 */
export function resolveAgentSimulationModel(
  mode: AgentSimulationMode | undefined,
  configuration: Pick<AgentPlanConfiguration, "connectionId" | "model">,
): ResolvedAgentAssignment | null {
  const runner = agentSimulationRunner(configuration.connectionId);
  if (runner === null) return null;
  if (!mode?.isActive || configuration.model !== AGENT_SIMULATION_MODEL)
    throw new AgentError("connection_not_found");
  return {
    connection: simulationConnection(runner),
    model: AGENT_SIMULATION_MODEL,
    reasoningEffort: null,
    supportsImages: true,
  };
}
