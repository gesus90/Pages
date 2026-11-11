import { vi } from "vitest";

import { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import {
  DEFAULT_ACP_RUN_OPTIONS,
  emptyAgentConfiguration,
} from "@/definition/AgentConfiguration";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRunEntry } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanTeam } from "@/backend/service/agents/AgentPlanAccess";
import type { PlanDependencies } from "@/backend/service/agents/AgentPlanDependencies";
import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type {
  AgentPlan,
  AgentPlanRun,
  AgentPlanSummary,
  AgentPlanTask,
  AgentPlanView,
} from "@/definition/AgentPlan";
import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type { AccountAccess } from "@/definition/Authorization";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

export const WORKSPACE_ID = "workspace-1";
export const PROJECT_ID = "project-1";
export const AGENT_ID = "agent-1";

export const ADMIN: AccountAccess = {
  userId: "admin",
  role: null,
  isAdmin: true,
  mode: "admin",
  firstName: "Ada",
  lastName: "Admin",
  isActive: true,
  departments: [],
  managedDepartments: [],
  allDepartments: true,
  allProjects: true,
  hasHadDepartment: false,
};

export const WORKSPACE: AgentWorkspaceChoice = {
  id: WORKSPACE_ID,
  name: "Repository",
  path: "/work/repository",
  projectId: PROJECT_ID,
  projectName: "Project",
  github: null,
  isUsable: true,
  reason: null,
};

/** Narrows a hand-written stand-in of a collaborator to the type the service expects. */
export function stub<T>(standIn: object): T {
  return standIn as T;
}

/** A catalog agent a plan node can name. */
export function catalogAgent(
  id = AGENT_ID,
  changes: Partial<AgentDefinitionChoice> = {},
): AgentDefinitionChoice {
  return {
    id,
    name: "Reviewer",
    model: "synthetic-model",
    reasoningEffort: null,
    provider: "codex_cli",
    purposes: [],
    revision: 1,
    configuration: {
      ...emptyAgentConfiguration(),
      run: DEFAULT_ACP_RUN_OPTIONS,
    },
    availability: { isUsable: true, reason: null, personalChoices: [] },
    ...changes,
  };
}

/** A stored plan run of the plan. */
export function planRun(changes: Partial<AgentPlanRun> = {}): AgentPlanRun {
  return {
    id: "run-1",
    planId: "plan-1",
    planName: "Plan",
    planRevision: 1,
    userId: "owner",
    startedAt: "2026-01-01 08:00:00",
    status: "running",
    stopRequested: false,
    steps: [],
    ...changes,
  };
}

/** A stored plan the person may edit. */
export function planView(changes: Partial<AgentPlanView> = {}): AgentPlanView {
  return {
    id: "plan-1",
    name: "Plan",
    ownerId: "owner",
    departmentId: null,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    usage: "private",
    globals: {},
    revision: 1,
    nodes: [],
    edges: [],
    canEdit: true,
    projectName: "Project",
    github: null,
    ...changes,
  };
}

interface RemoveOptions {
  readonly revision: number;
  readonly journal: (transaction: DatabaseTransaction) => Promise<void>;
}

type RunJournal = (transaction: DatabaseTransaction) => Promise<void>;

interface ResolvedDefinition {
  readonly assignment: {
    readonly connection: { readonly id: string; readonly provider: string };
  };
}

/** Every storage and collaborator boundary of the plan service, each a mock with a neutral answer. */
export class PlanMocks {
  public readonly plans = {
    list: vi.fn<() => Promise<readonly AgentPlan[]>>(async () => []),
    save: vi.fn<
      (
        plan: AgentPlan,
        isNew: boolean,
        bound?: (transaction: DatabaseTransaction) => Promise<void>,
        userId?: string,
      ) => Promise<void>
    >(async () => undefined),
    remove: vi.fn<
      (id: string, userId: string, options?: RemoveOptions) => Promise<void>
    >(async () => undefined),
  };
  public readonly runs = {
    find: vi.fn<(id: string) => Promise<AgentPlanRun | null>>(async () => null),
    entries: vi.fn<
      (
        userId: string,
        planId: string,
        order: string,
      ) => Promise<readonly AgentPlanRunEntry[]>
    >(async () => []),
    stepAgent: vi.fn<(runId: string, stepId: string) => Promise<string | null>>(
      async () => null,
    ),
  };
  public readonly workspaces = {
    resolve: vi.fn<
      (
        userId: string,
        workspaceId: string,
      ) => Promise<{
        readonly projectId: string;
        readonly executionTarget?: AgentPlanExecutionTarget;
      }>
    >(async () => ({ projectId: PROJECT_ID })),
    choices: vi.fn<
      (userId: string) => Promise<readonly AgentWorkspaceChoice[]>
    >(async () => []),
    forChannel: vi.fn<(channel: ActorChannel) => object>(() => ({})),
  };
  public readonly profiles = {
    catalog: vi.fn<
      (
        userId: string,
        projectId: string | null,
      ) => Promise<readonly AgentDefinitionChoice[]>
    >(async () => [catalogAgent()]),
    resolveDefinition: vi.fn<
      (userId: string, request: object) => Promise<ResolvedDefinition>
    >(async () => ({
      assignment: { connection: { id: "connection-1", provider: "codex_cli" } },
    })),
    userAgentIds: vi.fn<(actor: AccountAccess) => Promise<ReadonlySet<string>>>(
      async () => new Set(),
    ),
  };
  public readonly tasks = {
    list: vi.fn<
      (userId: string, projectId: string) => Promise<readonly AgentPlanTask[]>
    >(async () => []),
  };
  public readonly access = {
    require: vi.fn<(userId: string, id: string) => Promise<AgentPlanView>>(
      async () => planView(),
    ),
    list: vi.fn<(userId: string) => Promise<readonly AgentPlanView[]>>(
      async () => [],
    ),
    summaries: vi.fn<(userId: string) => Promise<readonly AgentPlanSummary[]>>(
      async () => [],
    ),
    directory: vi.fn<(userId: string) => Promise<AgentProfileDirectory>>(
      async () => ({ persons: [], departments: [], groups: [] }),
    ),
    team: vi.fn<
      (userId: string, workspaceId: string | null) => Promise<AgentPlanTeam>
    >(async () => ({ projectId: null, departmentIds: [], departmentId: null })),
    validateSharing: vi.fn<(plan: AgentPlan) => Promise<void>>(
      async () => undefined,
    ),
    forChannel: vi.fn<(channel: ActorChannel) => object>(() => ({})),
  };
  public readonly preparation = {
    prepare: vi.fn<(userId: string, plan: AgentPlan) => Promise<object>>(
      async () => ({}),
    ),
  };
  public readonly engine = {
    stop: vi.fn<(id: string, journal?: RunJournal) => Promise<void>>(
      async () => undefined,
    ),
    pause: vi.fn<(id: string, journal?: RunJournal) => Promise<void>>(
      async () => undefined,
    ),
    resume: vi.fn<
      (id: string, snapshot: object, journal?: RunJournal) => Promise<void>
    >(async () => undefined),
    stopProject: vi.fn<(projectId: string) => Promise<boolean>>(
      async () => true,
    ),
    shutdown: vi.fn<() => Promise<void>>(async () => undefined),
  };
}

export interface PlanContext {
  readonly mocks: PlanMocks;
  readonly dependencies: PlanDependencies;
  readonly service: AgentPlanService;
}

/** A plan service over mocked boundaries; `extra` adds or replaces optional collaborators. */
export function createPlanContext(
  extra: Partial<PlanDependencies> = {},
): PlanContext {
  const mocks = new PlanMocks();
  const dependencies: PlanDependencies = {
    ...stub<PlanDependencies>(mocks),
    ...extra,
  };
  return { mocks, dependencies, service: new AgentPlanService(dependencies) };
}
