import { canProcessRuns } from "@/backend/runtime/RunsMode";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { PlanRunCommandWorker } from "@/backend/service/agents/runs/PlanRunCommandWorker";
import { QueuedPlanRunEngine } from "@/backend/service/agents/runs/QueuedPlanRunEngine";
import { RunApiPlanAccess } from "@/backend/service/agents/runs/RunApiPlanAccess";
import { runApiSocketPath } from "@/backend/service/agents/runs/RunApiBridge";
import { runsSocketPath } from "@/backend/service/agents/runs/RunsSocket";
import { AgentLocalSessionPreparation } from "@/backend/service/agents/AgentLocalSessionPreparation";
import { AgentWorkspaceCleanupRepository } from "@/backend/database/repositories/agent/AgentWorkspaceCleanupRepository";
import { AgentWorkspaceCleanupService } from "@/backend/service/agents/AgentWorkspaceCleanupService";
import { AgentPlanStepReportService } from "@/backend/service/agents/AgentPlanStepReportService";
import { AgentPlanWorkGate } from "@/backend/service/agents/AgentPlanWorkGate";
import { AgentPlanStepProgressService } from "@/backend/service/agents/AgentPlanStepProgressService";
import { AgentPlanStepProgressRepository } from "@/backend/database/repositories/agent/AgentPlanStepProgressRepository";

import type { AgentPlanRemoteExecution } from "@/backend/service/agents/AgentPlanRemoteExecution";
import { AgentPlanStepReportRepository } from "@/backend/database/repositories/agent/AgentPlanStepReportRepository";
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
import { AgentPlanAutoResume } from "@/backend/service/agents/recovery/AgentPlanAutoResume";
import { AgentPlanRecoveryService } from "@/backend/service/agents/recovery/AgentPlanRecoveryService";
import { AgentPlanStartRejectionRepository } from "@/backend/database/repositories/agent/AgentPlanStartRejectionRepository";
import { AgentPlanCleanupFailureRepository } from "@/backend/database/repositories/agent/AgentPlanCleanupFailureRepository";
import { AgentPlanPreparation } from "@/backend/service/agents/AgentPlanPreparation";
import { AgentPlanScripts } from "@/backend/service/agents/AgentPlanScripts";
import { AgentPlanScriptPreparation } from "@/backend/service/agents/AgentPlanScriptPreparation";
import { AgentPlanScriptRunner } from "@/backend/service/agents/AgentPlanScriptRunner";
import { AgentPlanDecisionModel } from "@/backend/service/agents/branching/AgentPlanDecisionModel";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { AgentPlanActiveRunService } from "@/backend/service/agents/AgentPlanActiveRuns";
import { AgentPlanOverviewService } from "@/backend/service/agents/AgentPlanOverview";
import { AgentPlanRunHistoryService } from "@/backend/service/agents/AgentPlanRunHistoryService";
import { AgentPlanOwnerRunReader } from "@/backend/service/agents/AgentPlanOwnerRunReader";
import { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import { AgentPlanManagement } from "@/backend/service/agents/AgentPlanManagement";
import { AgentPlanTemplateService } from "@/backend/service/agents/AgentPlanTemplateService";
import { AgentPlanSessionAccess } from "@/backend/service/agents/AgentPlanSessionAccess";
import { PlanBridgeGrants } from "@/backend/service/agents/bridge/PlanBridgeGrants";
import { planSessionActivity } from "@/backend/service/agents/bridge/PlanSessionActivity";
import { isPagesRunsProcess } from "@/backend/runtime/RunsMode";
import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";
import { AgentPlanStepStart } from "@/backend/service/agents/AgentPlanStepStart";
import { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import { AgentPlanPhases } from "@/backend/service/agents/AgentPlanPhases";
import { AgentPlanTasks } from "@/backend/service/agents/AgentPlanTasks";
import { AgentSessionRepository } from "@/backend/database/repositories/agent/AgentSessionRepository";
import { AgentSessionInbox } from "@/backend/service/agents/sessions/AgentSessionInbox";
import { AgentSessionJournal } from "@/backend/service/agents/sessions/AgentSessionJournal";
import { AgentSessionService } from "@/backend/service/agents/sessions/AgentSessionService";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";

import { createPlanRemoteServices } from "./agent-plan-remote-services.server";
import { createPlanWorkspaceAccess } from "./plan-access-services.server";
import { createPicaMobileNotificationServices } from "./pica-mobile-notification-services.server";

import type { PlanRunEnginePort } from "@/backend/service/agents/runs/PlanRunEnginePort";
import type { RunnerPagesAccessService } from "@/backend/service/runner/RunnerPagesAccessService";
import type { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import type { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import type { Database } from "@/backend/database/Database";
import type {
  AgentPlanMcpSettings,
  AgentPlanSessionGrants,
} from "@/backend/service/agents/AgentPlanSessionAccess";
import type { AgentSessionRunAccess } from "@/backend/service/agents/sessions/AgentSessionService";
import type { TaskService } from "@/backend/service/TaskService";
import type { UserService } from "@/backend/service/UserService";
import type { PlanDependencies } from "@/backend/service/agents/AgentPlanService";
import type { PicaMobileNotificationService } from "@/backend/service/mobile/notifications/PicaMobileNotificationService";
import type { AgentApplicationServices } from "./agent-services.server";

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
  /** Creating, copying and deleting plans from the plan page, each request once. */
  readonly agentPlanManagement: AgentPlanManagement;
  /** The personal node templates of the plan editor, checked by the plan service. */
  readonly agentPlanTemplateService: AgentPlanTemplateService;
  readonly agentSessionService: AgentSessionService;
  readonly agentPlanRecoveryService: AgentPlanRecoveryService;
}

/** The plan services that loaders and actions reach directly besides the plan service. */
export type AgentPlanLoaderServices = Pick<
  AgentPlanServices,
  | "agentPlanActiveRunService"
  | "agentPlanOverviewService"
  | "agentPlanRunHistoryService"
  | "picaMobileNotifications"
  | "runnerPagesAccessService"
  | "planBridgeGrants"
  | "agentPlanManagement"
  | "agentPlanTemplateService"
>;

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

/** The file store of asset nodes, where one was wired (PAGE-268). */
function planAssetsOf(
  agents: Pick<AgentApplicationServices, "agentPlanAssetService">,
): Pick<PlanDependencies, "planAssets"> {
  return agents.agentPlanAssetService
    ? { planAssets: agents.agentPlanAssetService }
    : {};
}

/** The stores and gates of the plan service that need only the instance's own services. */
function planRecords(input: {
  readonly database: Database;
  readonly agents: AgentApplicationServices;
  readonly tasks: TaskService;
  readonly users: UserService;
}): Pick<
  PlanDependencies,
  | "workGate"
  | "stepProgress"
  | "phases"
  | "archive"
  | "startRejections"
  | "workspaceCleanup"
  | "planAssets"
> {
  return {
    workGate: new AgentPlanWorkGate(input.database, input.users),
    stepProgress: new AgentPlanStepProgressService({
      reports: new AgentPlanStepReportRepository(input.database),
      progress: new AgentPlanStepProgressRepository(input.database),
    }),
    phases: new AgentPlanPhases(input.tasks, input.users),
    archive: input.agents.agentRunArchive,
    startRejections: new AgentPlanStartRejectionRepository(input.database),
    workspaceCleanup: new AgentWorkspaceCleanupRepository(input.database),
    ...planAssetsOf(input.agents),
  };
}

/** Shares the existing user, ticket, model and workspace boundaries; no second catalog or runner. */
export async function createAgentPlanService(input: {
  readonly database: Database;
  readonly agents: AgentApplicationServices;
  readonly tasks: TaskService;
  readonly users: UserService;
  /** How sessions of ticket-bound nodes reach Pages through MCP. */
  readonly mcp: AgentPlanMcpSettings;
  readonly api: () => Promise<PagesAgentApiService>;
}): Promise<AgentPlanServices> {
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
  const pageAgentSessions = await createPageAgentSessions(input, {
    run: (userId, id) => service.run(userId, id),
    stop: (userId, id) => service.stop(userId, id),
  });
  const { remoteTargets, remoteExecution, pages } =
    await createPlanRemoteServices(input, access, runs, local);
  const engine = await createPlanEngine(input, {
    remoteExecution,
    scripts: scriptPreparation,
    runs,
    start,
    tasks,
    sessions,
    pageAgentSessions,
  });
  // The runner services are built first; runner facts learn which runs an engine still drives.
  const localEngine: AgentPlanRunEngine | null =
    engine instanceof AgentPlanRunEngine ? engine : null;
  input.agents.runnerService.attachRunOwnership(
    (id) => localEngine?.isActive(id) ?? true,
  );
  const preparation = new AgentPlanPreparation({
    workspaceCatalog,
    remoteExecution,
    remoteTargets,
    scripts: scriptPreparation,
    profiles,
    parameters,
    tasks,
    ...planAssetsOf(input.agents),
  });
  const dependencies: PlanDependencies = {
    ...planRecords(input),
    workspaceCatalog,
    remoteExecution,
    remoteTargets,
    plans,
    runs,
    workspaces,
    profiles,
    parameters,
    tasks,
    access,
    preparation,
    engine,
    sessions,
    scripts,
  };
  const service = new AgentPlanService(dependencies);
  const views = await createPlanViews(input, dependencies, service);
  await startOwnedPlanProcessing(input, {
    service,
    runs,
    engine,
    remoteExecution,
  });
  return {
    runnerPagesAccessService: pages,
    planBridgeGrants: grants,
    agentPlanService: service,
    agentLocalSessionPreparation: new AgentLocalSessionPreparation(runs, start),
    ...views,
    agentSessionService: pageAgentSessions,
    agentPlanRecoveryService: startPlanRecovery(input, {
      service,
      access,
      preparation,
      engine,
      runs,
      remoteExecution,
    }),
  };
}

function createPlanStepStart(
  input: Parameters<typeof createAgentPlanService>[0],
  access: AgentPlanAccess,
  tasks: AgentPlanTasks,
): AgentPlanStepStart {
  return new AgentPlanStepStart({
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
  },
): Promise<void> {
  if (!canProcessRuns()) return;
  const { service, runs, engine, remoteExecution } = parts;
  await recoverRuns(input, service);
  startWorkspaceCleanup(input.database, runs, engine, remoteExecution);
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
function startPlanRecovery(
  input: Parameters<typeof createAgentPlanService>[0],
  parts: Parameters<typeof createRecoveryService>[1],
): AgentPlanRecoveryService {
  const recovery = createRecoveryService(input, parts);
  if (canProcessRuns())
    void new AgentPlanAutoResume({
      runs: parts.runs,
      recovery,
      engine: parts.engine,
    }).start();
  return recovery;
}

/** The services that read, list or announce plans and runs through the plan service. */
async function createPlanViews(
  input: Parameters<typeof createAgentPlanService>[0],
  dependencies: PlanDependencies,
  service: AgentPlanService,
): Promise<
  Pick<
    AgentPlanServices,
    | "agentPlanActiveRunService"
    | "agentPlanOverviewService"
    | "agentPlanRunHistoryService"
    | "picaMobileNotifications"
    | "agentPlanManagement"
    | "agentPlanTemplateService"
  >
> {
  return {
    agentPlanActiveRunService: new AgentPlanActiveRunService(
      dependencies,
      service,
    ),
    agentPlanOverviewService: new AgentPlanOverviewService(
      dependencies,
      service,
    ),
    agentPlanRunHistoryService: new AgentPlanRunHistoryService(dependencies),
    ...(await createPicaMobileNotificationServices({
      database: input.database,
      users: input.users,
      ownerRuns: new AgentPlanOwnerRunReader(dependencies),
    })),
    ...createPlanManagement(input.database, service),
  };
}

function createPlanManagement(
  database: Database,
  service: AgentPlanService,
): Pick<AgentPlanServices, "agentPlanManagement" | "agentPlanTemplateService"> {
  return {
    agentPlanManagement: new AgentPlanManagement({ database, plans: service }),
    agentPlanTemplateService: new AgentPlanTemplateService({
      templates: new AgentPlanTemplateRepository(database),
      plans: service,
    }),
  };
}

function startWorkspaceCleanup(
  database: Database,
  runs: AgentPlanRunRepository,
  engine: PlanRunEnginePort,
  remoteExecution: AgentPlanRemoteExecution,
): void {
  new AgentWorkspaceCleanupService({
    obligations: new AgentWorkspaceCleanupRepository(database),
    runs,
    engine,
    remote: remoteExecution,
  }).start();
}

/**
 * The plan bridge access of this process.
 *
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
  const grants = new PlanBridgeGrants(planSessionActivity(runs));
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
  const journal = new AgentSessionJournal(store, {
    followExternalWrites:
      !canProcessRuns() || Boolean(input.agents.localSessions),
  });
  const inbox = new AgentSessionInbox(store, journal);
  if (canProcessRuns()) await inbox.recover();
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

async function createPlanEngine(
  input: Parameters<typeof createAgentPlanService>[0],
  parts: {
    readonly remoteExecution: AgentPlanRemoteExecution;
    readonly scripts: AgentPlanScriptPreparation;
    readonly runs: AgentPlanRunRepository;
    readonly start: AgentPlanStepStart;
    readonly tasks: AgentPlanTasks;
    readonly sessions: AgentPlanSessionGrants;
    readonly pageAgentSessions: AgentSessionService;
  },
): Promise<PlanRunEnginePort> {
  const runtime = await getPagesRuntime();
  if (!canProcessRuns())
    return new QueuedPlanRunEngine(
      input.database,
      runsSocketPath(runtime.getDatabasePath()),
    );
  return new AgentPlanRunEngine({
    deferScheduling: true,
    localSessions: input.agents.localSessions ?? undefined,
    workGate: new AgentPlanWorkGate(input.database, input.users),
    remoteExecution: parts.remoteExecution,
    scripts: new AgentPlanScriptRunner(parts.scripts),
    decisions: new AgentPlanDecisionModel({
      execution: input.agents.agentPlanExecution,
      profiles: input.agents.agentProfileService,
      tasks: parts.tasks,
    }),
    runs: parts.runs,
    start: parts.start,
    resources: input.agents.acpResourceScheduler,
    steps: new AgentPlanStepRunner({
      localSessions: input.agents.localSessions ?? undefined,
      start: parts.start,
      execution: input.agents.agentPlanExecution,
      tasks: parts.tasks,
      access: parts.sessions,
      stepReports: new AgentPlanStepReportService(
        new AgentPlanStepReportRepository(input.database),
        parts.tasks,
      ),
      stepProgress: new AgentPlanStepProgressService({
        reports: new AgentPlanStepReportRepository(input.database),
        progress: new AgentPlanStepProgressRepository(input.database),
      }),
      archive: input.agents.agentRunArchive,
      sessions: parts.pageAgentSessions,
    }),
    archive: input.agents.agentRunArchive,
    files: input.agents.agentDefinitionFiles,
  });
}
