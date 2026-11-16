import { AgentPlanSwarmMemoryRepository } from "@/backend/database/repositories/agent/AgentPlanSwarmMemoryRepository";
import { AgentPlanSwarmRepository } from "@/backend/database/repositories/agent/AgentPlanSwarmRepository";
import { AgentPlanDecisionModel } from "@/backend/service/agents/branching/AgentPlanDecisionModel";
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
    "acpResourceScheduler" | "agentProfileService" | "agentWorkspaceService"
  > & { readonly agentPlanExecution: PlanExecution };
}

/**
 * Builds the runners of the nodes that ask models in sessions of their own:
 * model decisions and swarms.
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
    decisions: new AgentPlanDecisionModel({
      execution: input.agents.agentPlanExecution,
      profiles: input.agents.agentProfileService,
      tasks: parts.tasks,
    }),
    swarms: createSwarmRunner({ ...input, ...parts }),
  };
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
