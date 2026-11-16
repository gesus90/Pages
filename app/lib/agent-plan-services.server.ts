import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";

import type { AgentPlanWorkspaceLocks } from "@/backend/service/agents/AgentPlanWorkspaceLocks";
import type { AgentPlanPreparation } from "@/backend/service/agents/AgentPlanPreparation";

import { CodexPlanUsageRepository } from "@/backend/database/repositories/agent/CodexPlanUsageRepository";
import { CodexAgentBudget } from "@/backend/service/agents/usage/CodexAgentBudget";
import { canProcessRuns } from "@/backend/runtime/RunsMode";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { PlanRunCommandWorker } from "@/backend/service/agents/runs/PlanRunCommandWorker";
import type { AgentPlanSwarmMemoryService } from "@/backend/service/agents/swarm/AgentPlanSwarmMemoryService";
import { RunApiPlanAccess } from "@/backend/service/agents/runs/RunApiPlanAccess";
import { runApiSocketPath } from "@/backend/service/agents/runs/RunApiBridge";
import { runsSocketPath } from "@/backend/service/agents/runs/RunsSocket";
import type { AgentLocalSessionPreparation } from "@/backend/service/agents/AgentLocalSessionPreparation";
import { AgentWorkspaceCleanupRepository } from "@/backend/database/repositories/agent/AgentWorkspaceCleanupRepository";
import { AgentWorkspaceCleanupService } from "@/backend/service/agents/AgentWorkspaceCleanupService";

import { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import { PlanBridgeGrantRepository } from "@/backend/database/repositories/agent/PlanBridgeGrantRepository";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import { AgentPlanRecoveryRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryRepository";
import { AgentPlanRecoveryExecutionRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository";
import { AgentPlanAutoResume } from "@/backend/service/agents/recovery/AgentPlanAutoResume";
import { AgentPlanRecoveryService } from "@/backend/service/agents/recovery/AgentPlanRecoveryService";
import { AgentPlanStartResourceRepository } from "@/backend/database/repositories/agent/AgentPlanStartResourceRepository";
import { AgentPlanCleanupFailureRepository } from "@/backend/database/repositories/agent/AgentPlanCleanupFailureRepository";
import { AgentPlanScripts } from "@/backend/service/agents/AgentPlanScripts";
import { AgentPlanScriptPreparation } from "@/backend/service/agents/AgentPlanScriptPreparation";
import { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import { AgentPlanSessionAccess } from "@/backend/service/agents/AgentPlanSessionAccess";
import { PlanBridgeGrants } from "@/backend/service/agents/bridge/PlanBridgeGrants";
import { planSessionActivity } from "@/backend/service/agents/bridge/PlanSessionActivity";
import { isPagesRunsProcess } from "@/backend/runtime/RunsMode";
import { AgentPlanStepStart } from "@/backend/service/agents/AgentPlanStepStart";
import { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import { AgentPlanTasks } from "@/backend/service/agents/AgentPlanTasks";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";

import { createPageAgentSessions } from "./agent-plan-page-sessions.server";
import { upgradeStoredPlans } from "./agent-plan-upgrade.server";
import { startOneShotPlanDeletion } from "./agent-plan-one-shot-services.server";
import { sessionRunAccess } from "./agent-plan-run-access.server";
import { createPlanRemoteServices } from "./agent-plan-remote-services.server";
import {
  createProcessingCore,
  planProcessingServices,
} from "./agent-plan-processing-services.server";
import {
  createPlanWorkspaceAccess,
  planAccessRecords,
} from "./plan-access-services.server";

import type { AgentSessionService } from "@/backend/service/agents/sessions/AgentSessionService";
import type { AgentPlanActiveRunService } from "@/backend/service/agents/AgentPlanActiveRuns";
import type { AgentPlanOverviewService } from "@/backend/service/agents/AgentPlanOverview";
import type { AgentPlanRunHistoryService } from "@/backend/service/agents/AgentPlanRunHistoryService";
import type { AgentPlanManagement } from "@/backend/service/agents/AgentPlanManagement";
import type { AgentPlanTemplateService } from "@/backend/service/agents/AgentPlanTemplateService";
import type { PicaMobileAutomationPush } from "@/backend/service/mobile/notifications/PicaMobileAutomationPush";
import type { AgentPlanRemoteExecution } from "@/backend/service/agents/AgentPlanRemoteExecution";
import type { PlanRunEnginePort } from "@/backend/service/agents/runs/PlanRunEnginePort";
import type { RunnerPagesAccessService } from "@/backend/service/runner/RunnerPagesAccessService";
import type { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import type { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import type { Database } from "@/backend/database/Database";
import type {
  AgentPlanMcpSettings,
  AgentPlanSessionGrants,
} from "@/backend/service/agents/AgentPlanSessionAccess";
import type { TaskService } from "@/backend/service/TaskService";
import type { UserService } from "@/backend/service/UserService";
import type { PlanDependencies } from "@/backend/service/agents/AgentPlanService";
import type { AgentPlanResumeAdvisorSlot } from "@/backend/service/agents/AgentPlanResumeAdvisor";
import type { PicaMobileNotificationService } from "@/backend/service/mobile/notifications/PicaMobileNotificationService";
import type { AgentRunDiagnosisSettingsService } from "@/backend/service/agents/diagnosis/AgentRunDiagnosisSettingsService";
import type { AgentApplicationServices } from "./agent-services.server";
import type { PlanAgentServices } from "./plan-agent-services.server";

/** The plan service and the PageAgentCLI sessions of its nodes, built on one run access. */
export interface AgentPlanServices {
  readonly runnerPagesAccessService: RunnerPagesAccessService;
  /** The bearers of the plan bridge; only the API process that serves the bridge holds them. */
  readonly planBridgeGrants: PlanBridgeGrants;
  readonly agentPlanService: AgentPlanService;
  readonly agentLocalSessionPreparation: AgentLocalSessionPreparation;
  /** The unfinished runs of one person, for clients that list them without the plan page. */
  readonly agentPlanActiveRunService: AgentPlanActiveRunService;
  /** The plans that concern one person with their latest own run, for Pica Mobile. */
  readonly agentPlanOverviewService: AgentPlanOverviewService;
  /** The runs of the plan page's history the person may read, without their content. */
  readonly agentPlanRunHistoryService: AgentPlanRunHistoryService;
  /** Pica Mobile notifications for runs of plans the person owns. */
  readonly picaMobileNotifications: PicaMobileNotificationService;
  /** Tells creators about finished automation runs on their devices. */
  readonly picaMobileAutomationPush: PicaMobileAutomationPush;
  /** Creating, copying and deleting plans from the plan page, each request once. */
  readonly agentPlanManagement: AgentPlanManagement;
  /** The personal node templates of the plan editor, checked by the plan service. */
  readonly agentPlanTemplateService: AgentPlanTemplateService;
  readonly agentSessionService: AgentSessionService;
  readonly agentPlanRecoveryService: AgentPlanRecoveryService;
  /** The shared memory of swarm nodes in the run view, with its export. */
  readonly agentPlanSwarmMemoryService: AgentPlanSwarmMemoryService;
  /** The retention and stall time of the run diagnosis under Settings → Agents. */
  readonly agentRunDiagnosisSettingsService: AgentRunDiagnosisSettingsService;
}

/** Plan engine, recovery and session readers without mobile notification or editor services. */
export type PlanProcessingServices = Pick<
  AgentPlanServices,
  | "runnerPagesAccessService"
  | "planBridgeGrants"
  | "agentPlanService"
  | "agentLocalSessionPreparation"
  | "agentSessionService"
  | "agentPlanRecoveryService"
  | "agentRunDiagnosisSettingsService"
>;

/** Creates the API-facing views after wiring the same plan processing boundaries. */
export async function createAgentPlanService(
  input: PlanProcessingInput,
): Promise<AgentPlanServices> {
  const { createPlanViews } = await import("./agent-plan-views.server");
  let views: Awaited<ReturnType<typeof createPlanViews>> | undefined;
  const { services } = await initializePlanProcessing({
    ...input,
    beforeRecovery: async (dependencies, service) => {
      views = await createPlanViews(input, dependencies, service);
    },
  });
  if (!views) throw new Error("Plan views were not initialized");
  return { ...services, ...views };
}

/** Starts only plan execution and recovery for the independent runs process. */
export async function createPlanProcessingServices(
  input: Parameters<typeof initializePlanProcessing>[0],
): Promise<PlanProcessingServices> {
  return (await initializePlanProcessing(input)).services;
}

/** The plan services that loaders and actions reach directly besides the plan service. */
export type AgentPlanLoaderServices = Pick<
  AgentPlanServices,
  | "agentPlanActiveRunService"
  | "agentPlanOverviewService"
  | "agentPlanRunHistoryService"
  | "picaMobileNotifications"
  | "picaMobileAutomationPush"
  | "runnerPagesAccessService"
  | "planBridgeGrants"
  | "agentPlanManagement"
  | "agentPlanTemplateService"
  | "agentRunDiagnosisSettingsService"
  | "agentPlanSwarmMemoryService"
>;

/** The interpreter profiles of script nodes, read when needed so a changed list applies without a restart. */
function planScripts(): AgentPlanScripts {
  return new AgentPlanScripts({
    snapshot: async () =>
      (await getPagesRuntime()).interpreterProfiles.snapshot(),
  });
}

/** Shares the existing user, ticket, model and workspace boundaries; no second catalog or runner. */
export interface PlanProcessingInput {
  readonly database: Database;
  readonly agents: PlanAgentServices;
  readonly tasks: TaskService;
  readonly users: UserService;
  /** How sessions of ticket-bound nodes reach Pages through MCP. */
  readonly mcp: AgentPlanMcpSettings;
  readonly api: () => Promise<PagesAgentApiService>;

  readonly beforeRecovery?: (
    dependencies: PlanDependencies,
    service: AgentPlanService,
  ) => Promise<void> | void;
}

async function initializePlanProcessing(input: PlanProcessingInput): Promise<{
  readonly services: PlanProcessingServices;
  readonly dependencies: PlanDependencies;
}> {
  const plans = new AgentPlanRepository(input.database);
  const runs = new AgentPlanRunRepository(input.database);
  if (canProcessRuns()) await upgradeStoredPlans(input.database, plans);
  const {
    agentWorkspaceService: workspaces,
    agentProfileService: profiles,
    agentParameterService: parameters,
  } = input.agents;
  const { access, workspaceCatalog } = createPlanWorkspaceAccess(input, plans);
  const runtime = createScriptRuntime(input, access, workspaces);
  const { tasks, scripts, scriptPreparation } = runtime;
  const start = createPlanStepStart(input, access, tasks);
  const { sessions, local, grants } = await createPlanSessionAccess(
    input,
    runs,
  );
  const pageAgentSessions = await createPageAgentSessions(
    input,
    sessionRunAccess(() => service),
  );
  const {
    remoteTargets,
    remoteExecution,
    pages,
    execution,
    scripts: runnerScripts,
  } = await createPlanRemoteServices(input, access, runs, {
    planAccess: local,
    scripts: scriptPreparation,
    bridges: grants,
  });
  const {
    dependencies,
    engine,
    preparation,
    resumeAdvisor,
    diagnosis,
    workspaceLocks,
  } = await createProcessingCore(input, {
    execution,
    runnerScripts,
    remoteExecution,
    scriptPreparation,
    plans,
    runs,
    start,
    tasks,
    sessions,
    pageAgentSessions,
    access,
    workspaceCatalog,
    remoteTargets,
    profiles,
    parameters,
    workspaces,
    scripts,
  });
  const service = new AgentPlanService(dependencies);
  await input.beforeRecovery?.(dependencies, service);
  const recovery = await startPlanRecovery(
    input,
    {
      service,
      access,
      preparation,
      engine,
      runs,
      remoteExecution,
      workspaceLocks,
    },
    resumeAdvisor,
  );
  if (canProcessRuns()) await workspaceLocks.start();
  return {
    dependencies,
    services: planProcessingServices({
      pages,
      grants,
      service,
      runs,
      start,
      pageAgentSessions,
      recovery,
      diagnosis,
    }),
  };
}

function createPlanStepStart(
  input: Parameters<typeof createAgentPlanService>[0],
  access: AgentPlanAccess,
  tasks: AgentPlanTasks,
): AgentPlanStepStart {
  return new AgentPlanStepStart({
    codexBudget: new CodexAgentBudget(
      new CodexPlanUsageRepository(input.database),
    ),
    access,
    tasks,
    profiles: input.agents.agentProfileService,
    parameters: input.agents.agentParameterService,
    files: input.agents.agentDefinitionFiles,
    github: input.agents.agentPlanGitHubCredentials,
  });
}

async function startOwnedPlanProcessing(
  input: Parameters<typeof createAgentPlanService>[0],
  parts: {
    readonly service: AgentPlanService;
    readonly runs: AgentPlanRunRepository;
    readonly engine: PlanRunEnginePort;
    readonly remoteExecution: AgentPlanRemoteExecution;
    readonly workspaceLocks: AgentPlanWorkspaceLocks;
  },
): Promise<void> {
  if (!canProcessRuns()) return;
  const { service, runs, engine, remoteExecution, workspaceLocks } = parts;
  await recoverRuns(input, service);
  startWorkspaceCleanup({
    database: input.database,
    runs,
    engine,
    remoteExecution,
    workspaceLocks,
  });
  startOneShotPlanDeletion(input.database);
  if (!(engine instanceof AgentPlanRunEngine)) return;
  const runtime = await getPagesRuntime();
  const worker = new PlanRunCommandWorker(
    input.database,
    engine,
    remoteExecution,
    runsSocketPath(runtime.getDatabasePath()),
  );
  await worker.start();
  registerShutdownTask(() => worker.stop(), { step: "run_command_inbox" });
}

/** Builds the recovery and lets the runs a restart interrupted continue; the wait runs in the background. */
async function startPlanRecovery(
  input: Parameters<typeof createAgentPlanService>[0],
  parts: Parameters<typeof createRecoveryService>[1],
  advisor: AgentPlanResumeAdvisorSlot,
): Promise<AgentPlanRecoveryService> {
  await startOwnedPlanProcessing(input, parts);
  const recovery = createRecoveryService(input, parts);
  advisor.current = recovery;
  if (canProcessRuns())
    void new AgentPlanAutoResume({
      runs: parts.runs,
      recovery,
      engine: parts.engine,
    }).start();
  return recovery;
}

function startWorkspaceCleanup(input: {
  readonly database: Database;
  readonly runs: AgentPlanRunRepository;
  readonly engine: PlanRunEnginePort;
  readonly remoteExecution: AgentPlanRemoteExecution;
  readonly workspaceLocks: AgentPlanWorkspaceLocks;
}): void {
  new AgentWorkspaceCleanupService({
    obligations: new AgentWorkspaceCleanupRepository(input.database),
    runs: input.runs,
    engine: input.engine,
    remote: input.remoteExecution,
    workspaceLocks: input.workspaceLocks,
  }).start();
}

/**
 * The plan bridge access of this process.
 * @remarks
 * `local` issues credentials and holds the bearers; it belongs to the process
 * that serves the bridge. An engine in its own process (`runsMode =
 * "separate"`) uses `sessions`, which asks the API for each bearer.
 */
async function createPlanSessionAccess(
  input: Parameters<typeof createAgentPlanService>[0],
  runs: AgentPlanRunRepository,
): Promise<{
  readonly sessions: AgentPlanSessionGrants;
  readonly local: AgentPlanSessionAccess;
  readonly grants: PlanBridgeGrants;
}> {
  const grants = new PlanBridgeGrants(
    planSessionActivity(runs),
    new PlanBridgeGrantRepository(input.database),
  );
  const local = new AgentPlanSessionAccess(
    new AgentRunCredentialService(
      new AgentRunCredentialRepository(input.database),
    ),
    input.mcp,
    grants,
  );
  if (!isPagesRunsProcess()) return { sessions: local, local, grants };
  const runtime = await getPagesRuntime();
  return {
    sessions: new RunApiPlanAccess(
      runApiSocketPath(runtime.getDatabasePath()),
      input.mcp,
    ),
    local,
    grants,
  };
}

/** Records the runs a server stop interrupted and repairs their files; their automatic continuation follows separately. */
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
    readonly engine: PlanRunEnginePort;
    readonly runs: AgentPlanRunRepository;
    readonly remoteExecution: AgentPlanRemoteExecution;
    readonly workspaceLocks: AgentPlanWorkspaceLocks;
  },
): AgentPlanRecoveryService {
  return new AgentPlanRecoveryService({
    runs: parts.service,
    recovery: new AgentPlanRecoveryRepository(input.database),
    cleanupFailures: new AgentPlanCleanupFailureRepository(input.database),
    checkpoints: new AgentPlanCheckpointRepository(input.database),
    execution: {
      access: parts.access,
      preparation: parts.preparation,
      engine: parts.engine,
      planRuns: parts.runs,
      remoteExecution: parts.remoteExecution,
      resources: input.agents.acpResourceScheduler,
      workspaceLocks: parts.workspaceLocks,
      restartOwners: new AgentPlanStartResourceRepository(input.database),
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
      approvals: planAccessRecords(input.database).scriptApprovals,
    }),
  };
}

/** A problem with these copies is reported and never keeps the server from starting. */
async function repairAgentFiles(input: {
  readonly database: Database;
  readonly agents: PlanAgentServices;
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
