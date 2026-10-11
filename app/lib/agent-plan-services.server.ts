import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import { AgentPlanPreparation } from "@/backend/service/agents/AgentPlanPreparation";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import { AgentPlanStepStart } from "@/backend/service/agents/AgentPlanStepStart";
import { AgentPlanTasks } from "@/backend/service/agents/AgentPlanTasks";

import type { Database } from "@/backend/database/Database";
import type { TaskService } from "@/backend/service/TaskService";
import type { UserService } from "@/backend/service/UserService";
import type { AgentApplicationServices } from "./agent-services.server";

/** Shares the existing user, ticket, model and workspace boundaries; no second catalog or runner. */
export async function createAgentPlanService(input: {
  readonly database: Database;
  readonly agents: AgentApplicationServices;
  readonly tasks: TaskService;
  readonly users: UserService;
}): Promise<AgentPlanService> {
  const plans = new AgentPlanRepository(input.database);
  const runs = new AgentPlanRunRepository(input.database);
  const {
    agentWorkspaceService: workspaces,
    agentProfileService: profiles,
    agentParameterService: parameters,
  } = input.agents;
  const access = new AgentPlanAccess(plans, workspaces);
  const tasks = new AgentPlanTasks(input.tasks, input.users);
  const engine = new AgentPlanRunEngine({
    runs,
    start: new AgentPlanStepStart({ access, tasks, profiles, parameters }),
    execution: input.agents.agentPlanExecution,
  });
  const service = new AgentPlanService({
    plans,
    runs,
    workspaces,
    profiles,
    parameters,
    tasks,
    access,
    preparation: new AgentPlanPreparation({ profiles, parameters, tasks }),
    engine,
  });
  await service.recoverInterruptedRuns();
  return service;
}
