import { AgentPlanSwarmRepository } from "@/backend/database/repositories/agent/AgentPlanSwarmRepository";
import { AgentPlanDecisionModel } from "@/backend/service/agents/branching/AgentPlanDecisionModel";
import { AgentPlanSwarmRunner } from "@/backend/service/agents/swarm/AgentPlanSwarmRunner";
import { PROCESS_SWARM_REGISTRY } from "@/backend/service/agents/swarm/SwarmRegistry";
import { MAX_ACP_SESSIONS } from "@/definition/AcpResource";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanSessionGrants } from "@/backend/service/agents/AgentPlanSessionAccess";
import type { AgentPlanTasks } from "@/backend/service/agents/AgentPlanTasks";
import type { AgentApplicationServices } from "./agent-services.server";

/** What the model nodes of the engine need from the server. */
interface ModelNodeServices {
  readonly database: Database;
  readonly agents: Pick<
    AgentApplicationServices,
    | "acpResourceScheduler"
    | "agentPlanExecution"
    | "agentProfileService"
    | "agentWorkspaceService"
  >;
}

/**
 * Builds the runners of the nodes that ask models in sessions of their own:
 * model decisions (PAGE-286) and swarms (PAGE-313).
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
 * Builds the runner of swarm nodes for the engine process (PAGE-313).
 *
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
    registry: PROCESS_SWARM_REGISTRY,
  });
}
