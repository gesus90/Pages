import { AgentPlanRemoteExecution } from "@/backend/service/agents/AgentPlanRemoteExecution";
import { AgentPlanRemoteTargets } from "@/backend/service/agents/AgentPlanRemoteTargets";
import { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { upgradePlanConfigurations } from "@/backend/service/agents/AgentPlanConfigurationUpgrade";
import { shareLegacyPlans } from "@/backend/service/agents/AgentPlanLegacyShare";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanTemplateRepository } from "@/backend/database/repositories/agent/AgentPlanTemplateRepository";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import { AgentPlanRecoveryRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryRepository";
import { AgentPlanRecoveryExecutionRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository";
import { AgentPlanRecoveryService } from "@/backend/service/agents/recovery/AgentPlanRecoveryService";
import { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import { AgentPlanPreparation } from "@/backend/service/agents/AgentPlanPreparation";
import { AgentPlanScripts } from "@/backend/service/agents/AgentPlanScripts";
import { AgentPlanScriptPreparation } from "@/backend/service/agents/AgentPlanScriptPreparation";
import { AgentPlanScriptRunner } from "@/backend/service/agents/AgentPlanScriptRunner";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import { AgentPlanManagement } from "@/backend/service/agents/AgentPlanManagement";
import { AgentPlanTemplateService } from "@/backend/service/agents/AgentPlanTemplateService";
import { AgentPlanSessionAccess } from "@/backend/service/agents/AgentPlanSessionAccess";
import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";
import { AgentPlanStepStart } from "@/backend/service/agents/AgentPlanStepStart";
import { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import { AgentPlanPhases } from "@/backend/service/agents/AgentPlanPhases";
import { AgentPlanTasks } from "@/backend/service/agents/AgentPlanTasks";
import { AgentPlanSharing } from "@/backend/service/agents/AgentPlanSharing";
import { AgentSessionRepository } from "@/backend/database/repositories/agent/AgentSessionRepository";
import { AgentSessionInbox } from "@/backend/service/agents/sessions/AgentSessionInbox";
import { AgentSessionJournal } from "@/backend/service/agents/sessions/AgentSessionJournal";
import { AgentSessionService } from "@/backend/service/agents/sessions/AgentSessionService";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import type { Database } from "@/backend/database/Database";
import type { AgentPlanMcpSettings } from "@/backend/service/agents/AgentPlanSessionAccess";
import type { AgentSessionRunAccess } from "@/backend/service/agents/sessions/AgentSessionService";
import type { TaskService } from "@/backend/service/TaskService";
import type { UserService } from "@/backend/service/UserService";
import type { AgentApplicationServices } from "./agent-services.server";

/** The plan service and the PageAgentCLI sessions of its nodes, built on one run access. */
export interface AgentPlanServices {
  readonly agentPlanService: AgentPlanService;
  /** Creating, copying and deleting plans from the plan page, each request once. */
  readonly agentPlanManagement: AgentPlanManagement;
  /** The personal node templates of the plan editor, checked by the plan service. */
  readonly agentPlanTemplateService: AgentPlanTemplateService;
  readonly agentSessionService: AgentSessionService;
  readonly agentPlanRecoveryService: AgentPlanRecoveryService;
}

/** The interpreter profiles of script nodes, read when needed so a changed list applies without a restart. */
function planScripts(): AgentPlanScripts {
  return new AgentPlanScripts({
    snapshot: async () =>
      (await getPagesRuntime()).interpreterProfiles.snapshot(),
  });
}

/**
 * Brings the plans stored by an earlier version up to date when the server starts.
 *
 * @remarks
 * Legacy node configurations are pinned, and the plans of before teams are
 * shared once with the team of their owner; the second step never throws.
 */
async function upgradeStoredPlans(
  database: Database,
  plans: AgentPlanRepository,
): Promise<void> {
  await upgradePlanConfigurations({
    plans,
    profiles: new AgentProfileRepository(database),
    connections: new AgentConnectionRepository(database),
  });
  await shareLegacyPlans({
    plans,
    authorization: new AuthorizationRepository(database),
  });
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
  await upgradeStoredPlans(input.database, plans);
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
  const runtime = createScriptRuntime(input, access, workspaces);
  const { tasks, scripts, scriptPreparation } = runtime;
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
  const { remoteTargets, remoteExecution } = createRemoteExecution(
    input,
    access,
    runs,
  );
  const engine = createPlanEngine(input, {
    remoteExecution,
    scripts: scriptPreparation,
    runs,
    start,
    tasks,
    sessions,
    pageAgentSessions,
  });
  const preparation = new AgentPlanPreparation({
    remoteExecution,
    remoteTargets,
    scripts: scriptPreparation,
    profiles,
    parameters,
    tasks,
  });
  const service = new AgentPlanService({
    remoteExecution,
    remoteTargets,
    plans,
    runs,
    workspaces,
    profiles,
    parameters,
    tasks,
    phases: new AgentPlanPhases(input.tasks, input.users),
    access,
    preparation,
    engine,
    sessions,
    archive: input.agents.agentRunArchive,
    scripts,
  });
  await recoverRuns(input, service);
  return {
    agentPlanService: service,
    agentPlanManagement: new AgentPlanManagement({
      database: input.database,
      plans: service,
    }),
    agentPlanTemplateService: new AgentPlanTemplateService({
      templates: new AgentPlanTemplateRepository(input.database),
      plans: service,
    }),
    agentSessionService: pageAgentSessions,
    agentPlanRecoveryService: createRecoveryService(input, {
      service,
      access,
      preparation,
      engine,
      runs,
    }),
  };
}

/** Records the runs a server stop interrupted and repairs their files; nothing starts again. */
async function recoverRuns(
  input: Parameters<typeof createAgentPlanService>[0],
  service: AgentPlanService,
): Promise<void> {
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
}

/** Inspection, preparations and the explicit restart, resume and release of disturbed runs. */
function createRecoveryService(
  input: Pick<
    Parameters<typeof createAgentPlanService>[0],
    "database" | "agents"
  >,
  parts: {
    readonly service: AgentPlanService;
    readonly access: AgentPlanAccess;
    readonly preparation: AgentPlanPreparation;
    readonly engine: AgentPlanRunEngine;
    readonly runs: AgentPlanRunRepository;
  },
): AgentPlanRecoveryService {
  return new AgentPlanRecoveryService({
    runs: parts.service,
    recovery: new AgentPlanRecoveryRepository(input.database),
    checkpoints: new AgentPlanCheckpointRepository(input.database),
    execution: {
      access: parts.access,
      preparation: parts.preparation,
      engine: parts.engine,
      planRuns: parts.runs,
      resources: input.agents.acpResourceScheduler,
      executions: new AgentPlanRecoveryExecutionRepository(input.database),
    },
  });
}

function createScriptRuntime(
  input: Pick<
    Parameters<typeof createAgentPlanService>[0],
    "database" | "tasks" | "users"
  >,
  access: AgentPlanAccess,
  workspaces: AgentApplicationServices["agentWorkspaceService"],
): {
  readonly tasks: AgentPlanTasks;
  readonly scripts: AgentPlanScripts;
  readonly scriptPreparation: AgentPlanScriptPreparation;
} {
  const tasks = new AgentPlanTasks(input.tasks, input.users);
  const scripts = planScripts();
  return {
    tasks,
    scripts,
    scriptPreparation: new AgentPlanScriptPreparation({
      scripts,
      workspaces,
      access,
      tasks,
      authorization: new AuthorizationRepository(input.database),
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
    logCaughtError("agent_plan_services", error);

    logDiagnostic(
      "agent_plan_services",
      "error",
      "Pages could not read the agents to repair their definition files.",
      error,
    );
  }
  await input.agents.agentRunArchive.recover();
}

function createRemoteExecution(
  input: Parameters<typeof createAgentPlanService>[0],
  access: AgentPlanAccess,
  runs: AgentPlanRunRepository,
): {
  remoteTargets: AgentPlanRemoteTargets;
  remoteExecution: AgentPlanRemoteExecution;
} {
  const remoteTargets = new AgentPlanRemoteTargets(
    input.agents.remoteWorkspaceService,
    input.agents.remoteConnectionService,
  );
  const remoteExecution = new AgentPlanRemoteExecution({
    targets: remoteTargets,
    access,
    runners: input.agents.runnerService,
    provider: input.agents.runnerOpenRouterService,
    runs,
  });
  return { remoteTargets, remoteExecution };
}

function createPlanEngine(
  input: Parameters<typeof createAgentPlanService>[0],
  parts: {
    readonly remoteExecution: AgentPlanRemoteExecution;
    readonly scripts: AgentPlanScriptPreparation;
    readonly runs: AgentPlanRunRepository;
    readonly start: AgentPlanStepStart;
    readonly tasks: AgentPlanTasks;
    readonly sessions: AgentPlanSessionAccess;
    readonly pageAgentSessions: AgentSessionService;
  },
): AgentPlanRunEngine {
  return new AgentPlanRunEngine({
    remoteExecution: parts.remoteExecution,
    scripts: new AgentPlanScriptRunner(parts.scripts),
    runs: parts.runs,
    start: parts.start,
    resources: input.agents.acpResourceScheduler,
    steps: new AgentPlanStepRunner({
      start: parts.start,
      execution: input.agents.agentPlanExecution,
      tasks: parts.tasks,
      access: parts.sessions,
      archive: input.agents.agentRunArchive,
      sessions: parts.pageAgentSessions,
    }),
    archive: input.agents.agentRunArchive,
    files: input.agents.agentDefinitionFiles,
  });
}
