import { AgentPlanSwarmMemoryRepository } from "@/backend/database/repositories/agent/AgentPlanSwarmMemoryRepository";
import { currentAgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import { SimulatedPlanDecision } from "@/backend/agents/simulation/SimulatedPlanDecision";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { AgentPlanSwarmRepository } from "@/backend/database/repositories/agent/AgentPlanSwarmRepository";
import { AgentPlanDecisionModel } from "@/backend/service/agents/branching/AgentPlanDecisionModel";
import { PlanDecisionModels } from "@/backend/service/agents/branching/PlanDecisionModels";
import { AgentPlanSwarmRunner } from "@/backend/service/agents/swarm/AgentPlanSwarmRunner";
import { PROCESS_SWARM_REGISTRY } from "@/backend/service/agents/swarm/SwarmRegistry";
import { MAX_ACP_SESSIONS } from "@/definition/AcpResource";

import type { Database } from "@/backend/database/Database";
import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanSessionGrants } from "@/backend/service/agents/AgentPlanSessionAccess";
import type { AgentPlanTasks } from "@/backend/service/agents/AgentPlanTasks";
import type { PlanAgentServices } from "./plan-agent-services.server";

/** What the model nodes of the engine need from the server. */
interface ModelNodeServices {
  readonly database: Database;
  readonly agents: Pick<
    PlanAgentServices,
    | "acpResourceScheduler"
    | "agentProfileService"
    | "agentWorkspaceService"
    | "chatDecisionSettingsService"
    | "decisionModelCalls"
  > & { readonly agentPlanExecution: PlanExecution };
}

/**
 * Builds the decision models of plans: the models a decision may choose and
 * the one an activation asks.
 * @param input - The database and the decision model setting of the instance.
 */
export function createPlanDecisionModels(input: {
  readonly database: Database;
  readonly agents: Pick<PlanAgentServices, "chatDecisionSettingsService">;
}): PlanDecisionModels {
  return new PlanDecisionModels({
    connections: new AgentConnectionRepository(input.database),
    authorization: new AuthorizationRepository(input.database),
    groups: new UserGroupRepository(input.database),
    settings: input.agents.chatDecisionSettingsService,
    isSimulation: currentAgentSimulationMode().isActive,
  });
}

/**
 * Builds the runners of the nodes that ask models of their own: model
 * decisions, which call the decisions interface, and swarms.
 */
export function createModelNodeRunners(
  input: ModelNodeServices,
  parts: {
    readonly tasks: AgentPlanTasks;
    readonly sessions: AgentPlanSessionGrants;
  },
): {
  readonly decisions: AgentPlanDecisionModel;
  readonly swarms: AgentPlanSwarmRunner;
} {
  return {
    decisions: createDecisionRunner(input, parts.tasks),
    swarms: createSwarmRunner({ ...input, ...parts }),
  };
}

/** Builds the runner of model decisions, which calls the decisions interface directly. */
function createDecisionRunner(
  input: ModelNodeServices,
  tasks: AgentPlanTasks,
): AgentPlanDecisionModel {
  const simulation = currentAgentSimulationMode();
  return new AgentPlanDecisionModel({
    tasks,
    models: createPlanDecisionModels(input),
    calls: input.agents.decisionModelCalls,
    simulation: simulation.isActive
      ? new SimulatedPlanDecision(simulation)
      : null,
  });
}

/**
 * Builds the runner of swarm nodes for the engine process.
 * @remarks
 * The swarm tools of its sessions reach it through the registry of this
 * process, directly or over the private socket of the engine.
 */
function createSwarmRunner(
  input: ModelNodeServices & {
    readonly tasks: AgentPlanTasks;
    readonly sessions: AgentPlanSessionGrants;
  },
): AgentPlanSwarmRunner {
  const scheduler = input.agents.acpResourceScheduler;
  return new AgentPlanSwarmRunner({
    execution: input.agents.agentPlanExecution,
    grants: input.sessions,
    profiles: input.agents.agentProfileService,
    capacity: () => {
      const runner = input.agents.agentPlanExecution.capacity?.();
      if (runner) return runner;
      const snapshot = scheduler.snapshot();
      const limit = snapshot.options.maxConcurrentAcpSessions;
      return {
        limit: limit === 0 ? MAX_ACP_SESSIONS : limit,
        active: snapshot.active.length,
      };
    },
    tasks: input.tasks,
    workspaces: input.agents.agentWorkspaceService,
    boards: new AgentPlanSwarmRepository(input.database),
    memories: new AgentPlanSwarmMemoryRepository(input.database),
    registry: PROCESS_SWARM_REGISTRY,
  });
}
