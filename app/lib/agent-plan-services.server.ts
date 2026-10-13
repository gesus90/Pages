import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import { AgentPlanPreparation } from "@/backend/service/agents/AgentPlanPreparation";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import { AgentPlanStepStart } from "@/backend/service/agents/AgentPlanStepStart";
import { AgentPlanTasks } from "@/backend/service/agents/AgentPlanTasks";
import { AgentPlanSharing } from "@/backend/service/agents/AgentPlanSharing";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";

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
  const sharing = new AgentPlanSharing(
    new AuthorizationRepository(input.database),
    new UserGroupRepository(input.database),
  );
  const access = new AgentPlanAccess(plans, workspaces, sharing);
  const tasks = new AgentPlanTasks(input.tasks, input.users);
  const engine = new AgentPlanRunEngine({
    runs,
    start: new AgentPlanStepStart({ access, tasks, profiles, parameters }),
    execution: input.agents.agentPlanExecution,
    archive: input.agents.agentRunArchive,
    files: input.agents.agentDefinitionFiles,
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
  // Interrupted runs ended just now, so their records are repaired as well.
  await repairAgentFiles(input);
  return service;
}

/** A problem with these copies is reported and never keeps the server from starting. */
async function repairAgentFiles(input: {
  readonly database: Database;
  readonly agents: AgentApplicationServices;
}): Promise<void> {
  try {
    await input.agents.agentDefinitionFiles.restore(
      await new AgentProfileRepository(input.database).list(),
    );
  } catch (error: unknown) {
    console.error(
      "Pages could not read the agents to repair their definition files.",
      error,
    );
  }
  await input.agents.agentRunArchive.recover();
}
