import { AgentLocalSessionPreparation } from "@/backend/service/agents/AgentLocalSessionPreparation";
import { AgentPlanAgentTodoRepository } from "@/backend/database/repositories/agent/AgentPlanAgentTodoRepository";
import { AgentPlanAgentTodoService } from "@/backend/service/agents/AgentPlanAgentTodoService";
import { AgentPlanPhases } from "@/backend/service/agents/AgentPlanPhases";
import { AgentPlanStartRejectionRepository } from "@/backend/database/repositories/agent/AgentPlanStartRejectionRepository";
import { AgentPlanStartResourceRepository } from "@/backend/database/repositories/agent/AgentPlanStartResourceRepository";
import { AgentPlanStartResources } from "@/backend/service/agents/AgentPlanStartResources";
import { AgentPlanInvocationRepository } from "@/backend/database/repositories/agent/AgentPlanInvocationRepository";
import { AgentPlanInvocations } from "@/backend/service/agents/invocation/AgentPlanInvocations";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { AgentPlanWorkGate } from "@/backend/service/agents/AgentPlanWorkGate";
import { AgentSessionRepository } from "@/backend/database/repositories/agent/AgentSessionRepository";
import { AgentWorkspaceCleanupRepository } from "@/backend/database/repositories/agent/AgentWorkspaceCleanupRepository";
import { createAttachedPlanEngine } from "./agent-plan-engine.server";
import {
  createPlanPreparation,
  planAssetsOf,
} from "./agent-plan-preparation.server";
import { createPlanTodoProgress } from "./agent-plan-todo-progress.server";
import { createPlanWorkspaceLocks } from "./agent-plan-run-access.server";
import { createRunDiagnosis } from "./run-diagnosis-services.server";
import { planAccessRecords } from "./plan-access-services.server";

import type { AgentPlanResumeAdvisorSlot } from "@/backend/service/agents/AgentPlanResumeAdvisor";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanScriptPreparation } from "@/backend/service/agents/AgentPlanScriptPreparation";
import type { AgentPlanStepStart } from "@/backend/service/agents/AgentPlanStepStart";
import type { Database } from "@/backend/database/Database";
import type { PlanDependencies } from "@/backend/service/agents/AgentPlanService";
import type { TaskService } from "@/backend/service/TaskService";
import type { UserService } from "@/backend/service/UserService";
import type { createPageAgentSessions } from "./agent-plan-page-sessions.server";
import type { createPlanRemoteServices } from "./agent-plan-remote-services.server";
import type { PlanAgentServices } from "./plan-agent-services.server";
import type {
  AgentPlanServices,
  PlanProcessingInput,
  PlanProcessingServices,
} from "./agent-plan-services.server";

/** Assembles the plan processing services from the wired processing parts. */
export function planProcessingServices(parts: {
  readonly pages: AgentPlanServices["runnerPagesAccessService"];
  readonly grants: AgentPlanServices["planBridgeGrants"];
  readonly service: AgentPlanServices["agentPlanService"];
  readonly runs: AgentPlanRunRepository;
  readonly start: AgentPlanStepStart;
  readonly pageAgentSessions: AgentPlanServices["agentSessionService"];
  readonly recovery: AgentPlanServices["agentPlanRecoveryService"];
  readonly diagnosis: ReturnType<typeof createRunDiagnosis>;
}): PlanProcessingServices {
  return {
    runnerPagesAccessService: parts.pages,
    planBridgeGrants: parts.grants,
    agentPlanService: parts.service,
    agentLocalSessionPreparation: new AgentLocalSessionPreparation(
      parts.runs,
      parts.start,
    ),
    agentSessionService: parts.pageAgentSessions,
    agentPlanRecoveryService: parts.recovery,
    agentRunDiagnosisSettingsService: parts.diagnosis.settings,
  };
}

/** Creates the engine, preparation, diagnosis, locks and dependencies a processing run needs. */
export async function createProcessingCore(
  input: PlanProcessingInput,
  parts: {
    readonly execution: Awaited<
      ReturnType<typeof createPlanRemoteServices>
    >["execution"];
    readonly runnerScripts: Awaited<
      ReturnType<typeof createPlanRemoteServices>
    >["scripts"];
    readonly remoteExecution: NonNullable<PlanDependencies["remoteExecution"]>;
    readonly remoteTargets: PlanDependencies["remoteTargets"];
    readonly scriptPreparation: AgentPlanScriptPreparation;
    readonly plans: PlanDependencies["plans"];
    readonly runs: PlanDependencies["runs"];
    readonly start: AgentPlanStepStart;
    readonly tasks: PlanDependencies["tasks"];
    readonly sessions: NonNullable<PlanDependencies["sessions"]>;
    readonly pageAgentSessions: Awaited<
      ReturnType<typeof createPageAgentSessions>
    >;
    readonly access: PlanDependencies["access"];
    readonly workspaceCatalog: NonNullable<
      PlanDependencies["workspaceCatalog"]
    >;
    readonly profiles: PlanDependencies["profiles"];
    readonly parameters: PlanDependencies["parameters"];
    readonly workspaces: PlanDependencies["workspaces"];
    readonly scripts: PlanDependencies["scripts"];
    readonly decisionModels?: PlanDependencies["decisionModels"];
  },
): Promise<{
  readonly dependencies: PlanDependencies;
  readonly engine: Awaited<ReturnType<typeof createAttachedPlanEngine>>;
  /** Present in the process that owns the runs; it makes plans call each other. */
  readonly invocations?: AgentPlanInvocations;
  readonly preparation: ReturnType<typeof createPlanPreparation>;
  readonly resumeAdvisor: AgentPlanResumeAdvisorSlot;
  readonly diagnosis: ReturnType<typeof createRunDiagnosis>;
  readonly workspaceLocks: ReturnType<typeof createPlanWorkspaceLocks>;
}> {
  const preparation = createPlanPreparation(input, {
    decisionModels: parts.decisionModels,
    workspaceCatalog: parts.workspaceCatalog,
    remoteExecution: parts.remoteExecution,
    remoteTargets: parts.remoteTargets,
    scripts: parts.scriptPreparation,
    profiles: parts.profiles,
    parameters: parts.parameters,
    tasks: parts.tasks,
  });
  const invocations = canProcessRuns()
    ? new AgentPlanInvocations({
        invocations: new AgentPlanInvocationRepository(input.database),
        access: parts.access,
        runs: parts.runs,
        preparation,
      })
    : undefined;
  const engine = await createAttachedPlanEngine(input, {
    execution: parts.execution,
    runnerScripts: parts.runnerScripts,
    remoteExecution: parts.remoteExecution,
    scripts: parts.scriptPreparation,
    runs: parts.runs,
    start: parts.start,
    tasks: parts.tasks,
    sessions: parts.sessions,
    pageAgentSessions: parts.pageAgentSessions,
    invocations,
  });
  if (invocations && engine instanceof AgentPlanRunEngine)
    invocations.attach(engine);
  const resumeAdvisor: AgentPlanResumeAdvisorSlot = { current: null };
  const diagnosis = createRunDiagnosis(input);
  const workspaceLocks = createPlanWorkspaceLocks(input, engine);
  const dependencies = planDependencies({
    workspaceLocks,
    records: planRecords(input),
    diagnosis,
    resumeAdvisor,
    workspaceCatalog: parts.workspaceCatalog,
    remoteExecution: parts.remoteExecution,
    remoteTargets: parts.remoteTargets,
    plans: parts.plans,
    runs: parts.runs,
    workspaces: parts.workspaces,
    profiles: parts.profiles,
    parameters: parts.parameters,
    tasks: parts.tasks,
    access: parts.access,
    preparation,
    engine,
    sessions: parts.sessions,
    scripts: parts.scripts,
    decisionModels: parts.decisionModels,
  });
  return {
    dependencies,
    engine,
    invocations,
    preparation,
    resumeAdvisor,
    diagnosis,
    workspaceLocks,
  };
}

/** The stores and gates of the plan service that need only the instance's own services. */
function planRecords(input: {
  readonly database: Database;
  readonly agents: PlanAgentServices;
  readonly tasks: TaskService;
  readonly users: UserService;
}): Pick<
  PlanDependencies,
  | "workGate"
  | "stepProgress"
  | "agentTodos"
  | "usage"
  | "phases"
  | "archive"
  | "startRejections"
  | "invocations"
  | "workspaceCleanup"
  | "planAssets"
  | "accessChanges"
  | "planAudit"
  | "scriptApprovals"
  | "startResources"
> {
  return {
    ...planAccessRecords(input.database),
    startResources: new AgentPlanStartResources({
      repository: new AgentPlanStartResourceRepository(input.database),
    }),
    workGate: new AgentPlanWorkGate(input.database, input.users),
    usage: new AgentSessionRepository(input.database),
    stepProgress: createPlanTodoProgress(input.database),
    agentTodos: new AgentPlanAgentTodoService(
      new AgentPlanAgentTodoRepository(input.database),
    ),
    phases: new AgentPlanPhases(input.tasks, input.users),
    archive: input.agents.agentRunArchive,
    startRejections: new AgentPlanStartRejectionRepository(input.database),
    invocations: new AgentPlanInvocationRepository(input.database),
    workspaceCleanup: new AgentWorkspaceCleanupRepository(input.database),
    ...planAssetsOf(input.agents),
  };
}

function planDependencies(options: {
  readonly workspaceLocks: PlanDependencies["workspaceLocks"];
  readonly records: ReturnType<typeof planRecords>;
  readonly diagnosis: ReturnType<typeof createRunDiagnosis>;
  readonly resumeAdvisor: PlanDependencies["resumeAdvisor"];
  readonly workspaceCatalog: PlanDependencies["workspaceCatalog"];
  readonly remoteExecution: PlanDependencies["remoteExecution"];
  readonly remoteTargets: PlanDependencies["remoteTargets"];
  readonly plans: PlanDependencies["plans"];
  readonly runs: PlanDependencies["runs"];
  readonly workspaces: PlanDependencies["workspaces"];
  readonly profiles: PlanDependencies["profiles"];
  readonly parameters: PlanDependencies["parameters"];
  readonly tasks: PlanDependencies["tasks"];
  readonly access: PlanDependencies["access"];
  readonly preparation: PlanDependencies["preparation"];
  readonly engine: PlanDependencies["engine"];
  readonly sessions: PlanDependencies["sessions"];
  readonly scripts: PlanDependencies["scripts"];
  readonly decisionModels: PlanDependencies["decisionModels"];
}): PlanDependencies {
  return {
    workspaceLocks: options.workspaceLocks,
    ...options.records,
    ...options.diagnosis.dependencies,
    resumeAdvisor: options.resumeAdvisor,
    workspaceCatalog: options.workspaceCatalog,
    remoteExecution: options.remoteExecution,
    remoteTargets: options.remoteTargets,
    plans: options.plans,
    runs: options.runs,
    workspaces: options.workspaces,
    profiles: options.profiles,
    parameters: options.parameters,
    tasks: options.tasks,
    access: options.access,
    preparation: options.preparation,
    engine: options.engine,
    sessions: options.sessions,
    scripts: options.scripts,
    decisionModels: options.decisionModels,
  };
}
