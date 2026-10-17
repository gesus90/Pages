import { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { upgradePlanConfigurations } from "@/backend/service/agents/AgentPlanConfigurationUpgrade";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import { AgentPlanRecoveryRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryRepository";
import { AgentPlanRecoveryService } from "@/backend/service/agents/recovery/AgentPlanRecoveryService";
import { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import { AgentPlanPreparation } from "@/backend/service/agents/AgentPlanPreparation";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import { AgentPlanSessionAccess } from "@/backend/service/agents/AgentPlanSessionAccess";
import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";
import { AgentPlanStepStart } from "@/backend/service/agents/AgentPlanStepStart";
import { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import { AgentPlanTasks } from "@/backend/service/agents/AgentPlanTasks";
import { AgentPlanSharing } from "@/backend/service/agents/AgentPlanSharing";
import { AgentSessionRepository } from "@/backend/database/repositories/agent/AgentSessionRepository";
import { AgentSessionInbox } from "@/backend/service/agents/sessions/AgentSessionInbox";
import { AgentSessionJournal } from "@/backend/service/agents/sessions/AgentSessionJournal";
import { AgentSessionService } from "@/backend/service/agents/sessions/AgentSessionService";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanMcpSettings } from "@/backend/service/agents/AgentPlanSessionAccess";
import type { AgentSessionRunAccess } from "@/backend/service/agents/sessions/AgentSessionService";
import type { TaskService } from "@/backend/service/TaskService";
import type { UserService } from "@/backend/service/UserService";
import type { AgentApplicationServices } from "./agent-services.server";

/** The plan service and the PageAgentCLI sessions of its nodes, built on one run access. */
export interface AgentPlanServices {
  readonly agentPlanService: AgentPlanService;
  readonly agentSessionService: AgentSessionService;
  readonly agentPlanRecoveryService: AgentPlanRecoveryService;
}

/** Shares the existing user, ticket, model and workspace boundaries; no second catalog or runner. */
export async function createAgentPlanService(input: {
  readonly database: Database;
  readonly agents: AgentApplicationServices;
  readonly tasks: TaskService;
  readonly users: UserService;
  /** How sessions of ticket-bound nodes reach Pages through MCP. */
  readonly mcp: AgentPlanMcpSettings;
}): Promise<AgentPlanServices> {
  const plans = new AgentPlanRepository(input.database);
  const runs = new AgentPlanRunRepository(input.database);
  await upgradePlanConfigurations({
    plans,
    profiles: new AgentProfileRepository(input.database),
    connections: new AgentConnectionRepository(input.database),
  });
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
  const start = new AgentPlanStepStart({
    access,
    tasks,
    profiles,
    parameters,
    files: input.agents.agentDefinitionFiles,
    github: input.agents.agentPlanGitHubCredentials,
  });
  const sessions = new AgentPlanSessionAccess(
    new AgentRunCredentialService(
      new AgentRunCredentialRepository(input.database),
    ),
    input.mcp,
  );
  const pageAgentSessions = await createPageAgentSessions(input, {
    run: (userId, id) => service.run(userId, id),
    stop: (userId, id) => service.stop(userId, id),
  });
  const engine = new AgentPlanRunEngine({
    runs,
    start,
    resources: input.agents.acpResourceScheduler,
    steps: new AgentPlanStepRunner({
      start,
      execution: input.agents.agentPlanExecution,
      tasks,
      access: sessions,
      archive: input.agents.agentRunArchive,
      sessions: pageAgentSessions,
    }),
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
    preparation: new AgentPlanPreparation({
      profiles,
      parameters,
      tasks,
    }),
    engine,
    sessions,
    archive: input.agents.agentRunArchive,
  });
  // The credential leftovers were cleaned up when the agent services started.
  await service.recoverInterruptedRuns(
    new Set(
      input.agents.agentCliGitHubCredentials
        .leftovers()
        .map((leftover) => leftover.instanceId),
    ),
  );
  // Interrupted runs ended just now, so their records are repaired as well.
  await repairAgentFiles(input);
  return {
    agentPlanService: service,
    agentSessionService: pageAgentSessions,
    agentPlanRecoveryService: new AgentPlanRecoveryService({
      runs: service,
      recovery: new AgentPlanRecoveryRepository(input.database),
      checkpoints: new AgentPlanCheckpointRepository(input.database),
    }),
  };
}

/**
 * Builds the PageAgentCLI sessions of plan nodes on the plan service's run access.
 *
 * @remarks
 * Deliveries a stopped server left on the way become `uncertain` before any
 * run starts; none is repeated automatically.
 */
async function createPageAgentSessions(
  input: {
    readonly database: Database;
    readonly agents: AgentApplicationServices;
  },
  runs: AgentSessionRunAccess,
): Promise<AgentSessionService> {
  const store = new AgentSessionRepository(input.database);
  const journal = new AgentSessionJournal(store);
  const inbox = new AgentSessionInbox(store, journal);
  await inbox.recover();
  return new AgentSessionService({
    runs,
    store,
    journal,
    inbox,
    hasPlanCheckpoint: async (runId) =>
      (await new AgentPlanCheckpointRepository(input.database).find(runId)) !==
      null,
    isWaitingForCapacity: (runId, stepId) =>
      input.agents.acpResourceScheduler
        .snapshot()
        .waiting.some(
          (request) => request.runId === runId && request.stepId === stepId,
        ),
  });
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
