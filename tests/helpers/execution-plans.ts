import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { vi } from "vitest";

import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AgentWorkspaceRepository } from "@/backend/database/repositories/agent/AgentWorkspaceRepository";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { TaskService } from "@/backend/service/TaskService";
import { AgentContentAccess } from "@/backend/service/agents/AgentContentAccess";
import { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import { AgentParameterService } from "@/backend/service/agents/AgentParameterService";
import { AgentWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";
import { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { AgentPlanAccess } from "@/backend/service/agents/AgentPlanAccess";
import { AgentPlanTasks } from "@/backend/service/agents/AgentPlanTasks";
import { AgentPlanPreparation } from "@/backend/service/agents/AgentPlanPreparation";
import { AgentPlanStepStart } from "@/backend/service/agents/AgentPlanStepStart";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { emptyAgentPlan } from "@/definition/AgentPlan";
import { AgentRunArchive } from "@/backend/service/agents/AgentRunArchive";
import { AgentDefinitionFiles } from "@/backend/service/agents/AgentDefinitionFiles";
import { PageAgentRunRepository } from "@/backend/database/repositories/agent/PageAgentRunRepository";

import { createAssistantHarness } from "./text-assistant";

import type { Database } from "@/backend/database/Database";
import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { AgentProfileInput } from "@/definition/AgentProfile";
import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanStep,
} from "@/definition/AgentPlan";

type AssistantHarness = Awaited<ReturnType<typeof createAssistantHarness>>;

interface WorkspaceFixture {
  readonly root: string;
  readonly projects: ProjectRepository;
  readonly workspaceRepository: AgentWorkspaceRepository;
  readonly workspaces: AgentWorkspaceService;
  readonly workspaceId: string;
  readonly secondWorkspaceId: string;
}

interface ProfileFixture {
  readonly profiles: AgentProfileService;
  readonly profileRepository: AgentProfileRepository;
  readonly parameters: AgentParameterService;
  readonly agentInput: AgentProfileInput;
  readonly agentId: string;
}

interface TaskFixture {
  readonly tasks: TaskService;
  readonly task: Awaited<ReturnType<TaskService["create"]>>;
  readonly subtask: Awaited<ReturnType<TaskService["create"]>>;
}

interface ControlledExecution {
  readonly cancelPending: ReturnType<typeof vi.fn<() => void>>;
  readonly run: ReturnType<typeof vi.fn<PlanExecution["run"]>>;
}

/** Real repositories and authorization with disposable directories and a controllable provider boundary. */
export type ExecutionPlanHarness = Omit<
  AssistantHarness,
  "profiles" | "execution" | "service"
> &
  WorkspaceFixture &
  ProfileFixture &
  TaskFixture & {
    readonly planRepository: AgentPlanRepository;
    readonly runRepository: AgentPlanRunRepository;
    readonly access: AgentPlanAccess;
    readonly preparation: AgentPlanPreparation;
    readonly stepStart: AgentPlanStepStart;
    readonly execution: ControlledExecution;
    readonly engine: AgentPlanRunEngine;
    readonly archive: AgentRunArchive;
    readonly files: AgentDefinitionFiles;
    readonly service: AgentPlanService;
    readonly dispose: () => Promise<void>;
  };

/** Real migrations, directories and authorization; provider execution is always injected. */
export async function createExecutionPlanHarness(
  database: Database,
): Promise<ExecutionPlanHarness> {
  const base = await createAssistantHarness(database);
  await base.authorization.saveAccount(base.admin);
  const workspace = await prepareWorkspaces(database, base);
  const profile = await prepareProfiles(database, base, workspace);
  const tasks = await prepareTasks(database, base);
  return assembleHarness(database, { base, workspace, profile, tasks });
}

async function prepareWorkspaces(
  database: Database,
  base: AssistantHarness,
): Promise<WorkspaceFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "pages-plans-"));
  await mkdir(path.join(root, "instance"));
  for (const name of ["one", "two", "three"])
    await mkdir(path.join(root, "approved", name), { recursive: true });
  const projects = new ProjectRepository(database);
  // A workspace needs a project with a GitHub link, like the one of a real instance.
  await projects.upsertIntegration("project", {
    repoUrl: "https://github.com/example/project.git",
    repoName: "example/project",
    tokenHash: "synthetic-hash",
    tokenEncrypted: "synthetic-ciphertext",
    syncIssues: false,
    syncStatus: false,
    syncComments: false,
    syncPullRequests: false,
    syncCommits: false,
    syncDirection: "pull",
    syncIntervalMinutes: 0,
    isConnected: true,
    lastSyncAt: null,
  });
  const workspaceRepository = new AgentWorkspaceRepository(database);
  const workspaces = new AgentWorkspaceService({
    workspaces: workspaceRepository,
    projects,
    authorization: base.authorization,
    paths: new AgentWorkspacePath({
      roots: [path.join(root, "approved")],
      protectedDirectory: path.join(root, "instance"),
    }),
  });
  const workspaceId = await workspaces.save(base.admin.userId, null, {
    name: "One",
    path: path.join(root, "approved", "one"),
    projectId: "project",
  });
  const secondWorkspaceId = await workspaces.save(base.admin.userId, null, {
    name: "Two",
    path: path.join(root, "approved", "two"),
    projectId: "project",
  });
  return {
    root,
    projects,
    workspaceRepository,
    workspaces,
    workspaceId,
    secondWorkspaceId,
  };
}

async function prepareProfiles(
  database: Database,
  base: AssistantHarness,
  workspace: WorkspaceFixture,
): Promise<ProfileFixture> {
  const content = new AgentContentAccess(
    workspace.projects,
    base.wiki.repository,
  );
  const profileRepository = new AgentProfileRepository(database);
  const profiles = new AgentProfileService({
    profiles: profileRepository,
    connections: base.connections,
    authorization: base.authorization,
    groups: new UserGroupRepository(database),
    operations: new AgentOperationRegistry(),
    content,
    workspaces: workspace.workspaces,
  });
  const parameters = new AgentParameterService({
    profiles,
    workspaces: workspace.workspaces,
    content,
    authorization: base.authorization,
  });
  const agentInput: AgentProfileInput = {
    name: "Worker",
    connectionId: "connection",
    model: "model-a",
    reasoningEffort: "medium",
    isActive: true,
    purposes: ["agent"],
    targets: [{ kind: "system", targetId: "agent" }],
    configuration: {
      ...emptyAgentConfiguration("system"),
      projectId: "project",
      markdown: "Input: {{input}}\nBranch: {{branch}}",
      sharing: { isGlobal: true, targets: [] },
      parameters: [
        {
          name: "input",
          type: "text",
          description: "Input",
          isRequired: true,
          defaultValue: { type: "text", text: "Default task" },
        },
        {
          name: "branch",
          type: "text",
          description: "Branch",
          isRequired: false,
          defaultValue: null,
        },
      ],
    },
  };
  const agentId = await profiles.save(base.admin, null, agentInput);
  return { profiles, profileRepository, parameters, agentInput, agentId };
}

async function prepareTasks(
  database: Database,
  base: AssistantHarness,
): Promise<TaskFixture> {
  const tasks = new TaskService(
    new TaskRepository(database),
    base.projectService,
    base.permissions,
  );
  const status = (await tasks.findAllStatuses(base.bob))[0];
  const task = await tasks.create(base.bob, {
    projectId: "project",
    type: "task",
    parentId: "ticket",
    title: "Implement worker",
    description: "Detailed task",
    statusId: status.id,
  });
  const subtask = await tasks.create(base.bob, {
    projectId: "project",
    type: "subtask",
    parentId: task.id,
    title: "Check branch",
    description: "Detailed subtask",
    statusId: status.id,
  });
  return { tasks, task, subtask };
}

function assembleHarness(
  database: Database,
  input: {
    readonly base: AssistantHarness;
    readonly workspace: WorkspaceFixture;
    readonly profile: ProfileFixture;
    readonly tasks: TaskFixture;
  },
): ExecutionPlanHarness {
  const { base, workspace, profile, tasks } = input;
  const planRepository = new AgentPlanRepository(database);
  const runRepository = new AgentPlanRunRepository(database);
  const access = new AgentPlanAccess(planRepository, workspace.workspaces);
  const planTasks = new AgentPlanTasks(tasks.tasks, {
    getById: (id) => new UserRepository(database).findById(id),
  });
  const preparation = new AgentPlanPreparation({
    profiles: profile.profiles,
    parameters: profile.parameters,
    tasks: planTasks,
  });
  const stepStart = new AgentPlanStepStart({
    profiles: profile.profiles,
    parameters: profile.parameters,
    access,
    tasks: planTasks,
  });
  const execution: ControlledExecution = {
    cancelPending: vi.fn<() => void>(),
    run: vi.fn<PlanExecution["run"]>().mockImplementation(async (request) => {
      await request.beforeStart?.();
      return "Completed";
    }),
  };
  const archive = new AgentRunArchive(
    new PageAgentRunRepository(database),
    path.join(workspace.root, "Agents"),
  );
  const files = new AgentDefinitionFiles(
    path.join(workspace.root, "Agents"),
    () => profile.profileRepository.list(),
  );
  const engine = new AgentPlanRunEngine({
    archive,
    files,
    runs: runRepository,
    start: stepStart,
    execution,
  });
  const service = new AgentPlanService({
    plans: planRepository,
    runs: runRepository,
    profiles: profile.profiles,
    parameters: profile.parameters,
    workspaces: workspace.workspaces,
    tasks: planTasks,
    access,
    preparation,
    engine,
  });
  return {
    ...base,
    ...workspace,
    ...profile,
    ...tasks,
    planRepository,
    runRepository,
    access,
    preparation,
    stepStart,
    execution,
    engine,
    service,
    archive,
    files,
    async dispose(): Promise<void> {
      execution.cancelPending();
      await engine.shutdown();
      await rm(workspace.root, { recursive: true, force: true });
      await rm(base.wiki.filesDirectory, { recursive: true, force: true });
    },
  };
}

interface ControlledPlanStep {
  readonly resolve: (output: string) => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal;
}

/** Repeated agent definitions get separate step identifiers and orders. */
export function executionStep(
  id: string,
  agentId: string,
  bindings: Readonly<Record<string, AgentPlanBinding>> = {},
): AgentPlanStep {
  return {
    id,
    type: "agent",
    agentId,
    personalAgentId: null,
    instruction: id,
    x: 20,
    y: 20,
    bindings,
  };
}

/** Minimal saved plan input used by functional execution tests. */
export function executionPlan(
  workspaceId: string,
  agentId: string,
  overrides: Partial<AgentPlanInput> = {},
): AgentPlanInput {
  return {
    ...emptyAgentPlan(),
    name: "Build",
    workspaceId,
    nodes: [executionStep("A", agentId)],
    ...overrides,
  };
}

/** Manual adapter completion verifies ordering without relying on timing or external providers. */
export function controlExecution(
  execution: ControlledExecution,
): Map<string, ControlledPlanStep> {
  const pending = new Map<string, ControlledPlanStep>();
  execution.cancelPending.mockImplementation(() => {
    for (const step of pending.values())
      step.reject(new AgentPlanCancelledError());
  });
  execution.run.mockImplementation(async (input, signal) => {
    await input.beforeStart?.();
    if (signal.aborted) throw new AgentPlanCancelledError();
    const id = input.prompt.split("\n\n").at(-1) ?? "";
    return new Promise<string>((resolve, reject) =>
      pending.set(id, { resolve, reject, signal }),
    );
  });
  return pending;
}

/** DuckDB-backed authorization needs more than the default one-second polling budget under concurrent checks. */
export function waitForPlan(
  callback: () => void | Promise<void>,
): Promise<void> {
  return vi.waitFor(callback, { timeout: 5000 });
}
