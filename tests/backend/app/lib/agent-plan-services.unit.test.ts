import { beforeEach, expect, it, vi } from "vitest";

import { createAgentPlanService } from "@/app/lib/agent-plan-services.server";
import { createPlanWorkspaceAccess } from "@/app/lib/plan-access-services.server";
import { upgradePlanConfigurations } from "@/backend/service/agents/AgentPlanConfigurationUpgrade";
import { shareLegacyPlans } from "@/backend/service/agents/AgentPlanLegacyShare";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { AgentPlanWorkGate } from "@/backend/service/agents/AgentPlanWorkGate";
import { AgentPlanRemoteExecution } from "@/backend/service/agents/AgentPlanRemoteExecution";
import { AgentPlanRemoteParameters } from "@/backend/service/agents/AgentPlanRemoteParameters";
import { RunnerPagesAccessService } from "@/backend/service/runner/RunnerPagesAccessService";
import { AgentPlanRemoteAccessRepository } from "@/backend/database/repositories/agent/AgentPlanRemoteAccessRepository";
import { AgentPlanRemoteTargets } from "@/backend/service/agents/AgentPlanRemoteTargets";
import { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanTemplateRepository } from "@/backend/database/repositories/agent/AgentPlanTemplateRepository";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentPlanStartRejectionRepository } from "@/backend/database/repositories/agent/AgentPlanStartRejectionRepository";
import { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import { AgentPlanCleanupFailureRepository } from "@/backend/database/repositories/agent/AgentPlanCleanupFailureRepository";
import { AgentPlanRecoveryRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryRepository";
import { AgentPlanRecoveryExecutionRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository";
import { AgentPlanRecoveryService } from "@/backend/service/agents/recovery/AgentPlanRecoveryService";
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
import { AgentSessionRepository } from "@/backend/database/repositories/agent/AgentSessionRepository";
import { AgentSessionInbox } from "@/backend/service/agents/sessions/AgentSessionInbox";
import { AgentSessionJournal } from "@/backend/service/agents/sessions/AgentSessionJournal";
import { AgentSessionService } from "@/backend/service/agents/sessions/AgentSessionService";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";

import type { Mock } from "vitest";
import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type { AgentApplicationServices } from "@/app/lib/agent-services.server";
import type { Database } from "@/backend/database/Database";
import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";
import type { AgentPlanMcpSettings } from "@/backend/service/agents/AgentPlanSessionAccess";
import type { TaskService } from "@/backend/service/TaskService";
import type { UserService } from "@/backend/service/UserService";

const { fakeClasses, opaque, partial } = await vi.hoisted(
  async () => import("./service-wiring-fakes"),
);

vi.mock("@/app/lib/plan-access-services.server", () => ({
  createPlanWorkspaceAccess: vi.fn(),
}));
vi.mock("@/backend/service/agents/AgentPlanConfigurationUpgrade", () => ({
  upgradePlanConfigurations: vi.fn(),
}));
vi.mock("@/backend/service/agents/AgentPlanLegacyShare", () => ({
  shareLegacyPlans: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
}));
vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: vi.fn(),
}));
vi.mock("@/backend/service/agents/AgentPlanWorkGate", () =>
  fakeClasses({ AgentPlanWorkGate: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanRemoteExecution", () =>
  fakeClasses({ AgentPlanRemoteExecution: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanRemoteParameters", () =>
  fakeClasses({ AgentPlanRemoteParameters: [] }),
);
vi.mock("@/backend/service/runner/RunnerPagesAccessService", () =>
  fakeClasses({ RunnerPagesAccessService: ["recover"] }),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanRemoteAccessRepository",
  () => fakeClasses({ AgentPlanRemoteAccessRepository: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanRemoteTargets", () =>
  fakeClasses({ AgentPlanRemoteTargets: [] }),
);
vi.mock(
  "@/backend/database/repositories/mcp/AgentRunCredentialRepository",
  () => fakeClasses({ AgentRunCredentialRepository: [] }),
);
vi.mock("@/backend/database/repositories/AgentConnectionRepository", () =>
  fakeClasses({ AgentConnectionRepository: [] }),
);
vi.mock("@/backend/database/repositories/agent/AgentPlanRepository", () =>
  fakeClasses({ AgentPlanRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanTemplateRepository",
  () => fakeClasses({ AgentPlanTemplateRepository: [] }),
);
vi.mock("@/backend/database/repositories/agent/AgentProfileRepository", () =>
  fakeClasses({ AgentProfileRepository: ["list"] }),
);
vi.mock("@/backend/database/repositories/agent/AgentPlanRunRepository", () =>
  fakeClasses({ AgentPlanRunRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanStartRejectionRepository",
  () => fakeClasses({ AgentPlanStartRejectionRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanCheckpointRepository",
  () => fakeClasses({ AgentPlanCheckpointRepository: ["find"] }),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanCleanupFailureRepository",
  () => fakeClasses({ AgentPlanCleanupFailureRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanRecoveryRepository",
  () => fakeClasses({ AgentPlanRecoveryRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository",
  () => fakeClasses({ AgentPlanRecoveryExecutionRepository: [] }),
);
vi.mock("@/backend/service/agents/recovery/AgentPlanRecoveryService", () =>
  fakeClasses({ AgentPlanRecoveryService: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanPreparation", () =>
  fakeClasses({ AgentPlanPreparation: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanScripts", () =>
  fakeClasses({ AgentPlanScripts: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanScriptPreparation", () =>
  fakeClasses({ AgentPlanScriptPreparation: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanScriptRunner", () =>
  fakeClasses({ AgentPlanScriptRunner: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanRunEngine", () =>
  fakeClasses({ AgentPlanRunEngine: ["isActive"] }),
);
vi.mock("@/backend/service/agents/AgentPlanService", () =>
  fakeClasses({ AgentPlanService: ["run", "stop", "recoverInterruptedRuns"] }),
);
vi.mock("@/backend/service/agents/AgentPlanManagement", () =>
  fakeClasses({ AgentPlanManagement: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanTemplateService", () =>
  fakeClasses({ AgentPlanTemplateService: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanSessionAccess", () =>
  fakeClasses({ AgentPlanSessionAccess: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanStepRunner", () =>
  fakeClasses({ AgentPlanStepRunner: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanStepStart", () =>
  fakeClasses({ AgentPlanStepStart: [] }),
);
vi.mock("@/backend/service/mcp/AgentRunCredentialService", () =>
  fakeClasses({ AgentRunCredentialService: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanPhases", () =>
  fakeClasses({ AgentPlanPhases: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanTasks", () =>
  fakeClasses({ AgentPlanTasks: [] }),
);
vi.mock("@/backend/database/repositories/agent/AgentSessionRepository", () =>
  fakeClasses({ AgentSessionRepository: [] }),
);
vi.mock("@/backend/service/agents/sessions/AgentSessionInbox", () =>
  fakeClasses({ AgentSessionInbox: ["recover"] }),
);
vi.mock("@/backend/service/agents/sessions/AgentSessionJournal", () =>
  fakeClasses({ AgentSessionJournal: [] }),
);
vi.mock("@/backend/service/agents/sessions/AgentSessionService", () =>
  fakeClasses({ AgentSessionService: [] }),
);
vi.mock("@/backend/database/repositories/AuthorizationRepository", () =>
  fakeClasses({ AuthorizationRepository: [] }),
);

type PlanInput = Parameters<typeof createAgentPlanService>[0];

/** Agent services whose startup steps record their calls. */
interface AgentFixture {
  readonly agents: AgentApplicationServices;
  readonly restore: Mock;
  readonly recoverArchive: Mock;
  readonly attachRunOwnership: Mock<RunnerService["attachRunOwnership"]>;
  readonly waiting: { runId: string; stepId: string }[];
}

const DATABASE = opaque<Database>("database");
const TASKS = opaque<TaskService>("tasks");
const USERS = opaque<UserService>("users");
const MCP = opaque<AgentPlanMcpSettings>("mcp settings");
const API = vi.fn<PlanInput["api"]>();
const ACCESS = opaque("plan access");
const CATALOG = opaque("workspace catalog");

function agentFixture(): AgentFixture {
  const restore = vi.fn(async () => undefined);
  const recoverArchive = vi.fn(async () => undefined);
  const attachRunOwnership = vi.fn<RunnerService["attachRunOwnership"]>();
  const waiting: { runId: string; stepId: string }[] = [];
  const agents = partial<AgentApplicationServices>({
    agentWorkspaceService: opaque("workspaces"),
    agentProfileService: opaque("profiles"),
    agentParameterService: opaque("parameters"),
    agentDefinitionFiles: { restore },
    agentPlanGitHubCredentials: opaque("github credentials"),
    agentCliGitHubCredentials: {
      leftovers: () => [{ instanceId: "instance-1" }],
    },
    agentRunArchive: { recover: recoverArchive },
    agentPlanExecution: opaque("plan execution"),
    acpResourceScheduler: { snapshot: () => ({ waiting }) },
    runnerService: { attachRunOwnership },
    runnerOpenRouterService: opaque("open router"),
    remoteWorkspaceService: opaque("remote workspaces"),
    remoteConnectionService: opaque("remote connections"),
    agentTicketParameterService: opaque("ticket parameters"),
    agentContentAccess: opaque("content"),
    agentTicketAssetService: opaque("ticket assets"),
  });
  return { agents, restore, recoverArchive, attachRunOwnership, waiting };
}

function planInput(agents: AgentApplicationServices): PlanInput {
  return {
    database: DATABASE,
    agents,
    tasks: TASKS,
    users: USERS,
    mcp: MCP,
    api: API,
  };
}

/** The only instance a fake class created. */
function only<Instance>(fake: {
  readonly mock: { readonly instances: Instance[] };
}): Instance {
  expect(fake.mock.instances).toHaveLength(1);
  return fake.mock.instances[0];
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createPlanWorkspaceAccess).mockReturnValue(
    partial({ access: ACCESS, workspaceCatalog: CATALOG }),
  );
  vi.mocked(AgentProfileRepository.prototype.list).mockResolvedValue([
    opaque("profile"),
  ]);
});

it("upgrades stored plans before anything is built on them", async () => {
  const { agents } = agentFixture();

  await createAgentPlanService(planInput(agents));

  const plans = only(vi.mocked(AgentPlanRepository));
  expect(upgradePlanConfigurations).toHaveBeenCalledWith({
    plans,
    profiles: vi.mocked(AgentProfileRepository).mock.instances[0],
    connections: only(vi.mocked(AgentConnectionRepository)),
  });
  expect(shareLegacyPlans).toHaveBeenCalledWith({
    plans,
    authorization: vi.mocked(AuthorizationRepository).mock.instances[0],
  });
  expect(vi.mocked(shareLegacyPlans).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(AgentSessionInbox.prototype.recover).mock.invocationCallOrder[0],
  );
  expect(vi.mocked(createPlanWorkspaceAccess).mock.calls[0][1]).toBe(plans);
});

it("returns the plan service with its management, templates, sessions and recovery", async () => {
  const { agents } = agentFixture();

  const services = await createAgentPlanService(planInput(agents));

  const service = only(vi.mocked(AgentPlanService));
  expect(services).toEqual({
    runnerPagesAccessService: only(vi.mocked(RunnerPagesAccessService)),
    agentPlanService: service,
    agentPlanManagement: only(vi.mocked(AgentPlanManagement)),
    agentPlanTemplateService: only(vi.mocked(AgentPlanTemplateService)),
    agentSessionService: only(vi.mocked(AgentSessionService)),
    agentPlanRecoveryService: only(vi.mocked(AgentPlanRecoveryService)),
  });
  expect(vi.mocked(AgentPlanManagement).mock.calls[0][0]).toEqual({
    database: DATABASE,
    plans: service,
  });
  expect(vi.mocked(AgentPlanTemplateService).mock.calls[0][0]).toEqual({
    templates: only(vi.mocked(AgentPlanTemplateRepository)),
    plans: service,
  });
});

it("wires the plan service on one access, preparation and engine", async () => {
  const { agents } = agentFixture();

  await createAgentPlanService(planInput(agents));

  const [options] = vi.mocked(AgentPlanService).mock.calls[0];
  expect(options).toEqual({
    workGate: vi.mocked(AgentPlanWorkGate).mock.instances[1],
    workspaceCatalog: CATALOG,
    remoteExecution: only(vi.mocked(AgentPlanRemoteExecution)),
    remoteTargets: only(vi.mocked(AgentPlanRemoteTargets)),
    plans: only(vi.mocked(AgentPlanRepository)),
    runs: only(vi.mocked(AgentPlanRunRepository)),
    workspaces: agents.agentWorkspaceService,
    profiles: agents.agentProfileService,
    parameters: agents.agentParameterService,
    tasks: vi.mocked(AgentPlanTasks).mock.instances[0],
    phases: only(vi.mocked(AgentPlanPhases)),
    access: ACCESS,
    preparation: only(vi.mocked(AgentPlanPreparation)),
    engine: only(vi.mocked(AgentPlanRunEngine)),
    sessions: only(vi.mocked(AgentPlanSessionAccess)),
    archive: agents.agentRunArchive,
    scripts: only(vi.mocked(AgentPlanScripts)),
    startRejections: only(vi.mocked(AgentPlanStartRejectionRepository)),
  });
  expect(vi.mocked(AgentPlanStartRejectionRepository).mock.calls).toEqual([
    [DATABASE],
  ]);
  expect(vi.mocked(AgentPlanPhases).mock.calls).toEqual([[TASKS, USERS]]);
  expect(vi.mocked(AgentPlanWorkGate).mock.calls).toEqual([
    [DATABASE, USERS],
    [DATABASE, USERS],
  ]);
  expect(vi.mocked(AgentPlanPreparation).mock.calls[0][0]).toEqual({
    workspaceCatalog: CATALOG,
    remoteExecution: options.remoteExecution,
    remoteTargets: options.remoteTargets,
    scripts: only(vi.mocked(AgentPlanScriptPreparation)),
    profiles: agents.agentProfileService,
    parameters: agents.agentParameterService,
    tasks: options.tasks,
  });
});

it("prepares scripts and step starts on the shared plan tasks", async () => {
  const { agents } = agentFixture();

  await createAgentPlanService(planInput(agents));

  const [tasks] = vi.mocked(AgentPlanTasks).mock.instances;
  expect(vi.mocked(AgentPlanTasks).mock.calls[0]).toEqual([TASKS, USERS]);
  expect(vi.mocked(AgentPlanScriptPreparation).mock.calls[0][0]).toEqual({
    scripts: only(vi.mocked(AgentPlanScripts)),
    workspaces: agents.agentWorkspaceService,
    access: ACCESS,
    tasks,
    authorization: vi.mocked(AuthorizationRepository).mock.instances[1],
  });
  expect(vi.mocked(AgentPlanStepStart).mock.calls[0][0]).toEqual({
    access: ACCESS,
    tasks,
    profiles: agents.agentProfileService,
    parameters: agents.agentParameterService,
    files: agents.agentDefinitionFiles,
    github: agents.agentPlanGitHubCredentials,
  });
});

it("reads the interpreter profiles of script nodes when they are needed", async () => {
  const { agents } = agentFixture();
  const snapshot = vi.fn(async () => opaque("interpreters"));
  vi.mocked(getPagesRuntime).mockResolvedValue(
    partial<PagesRuntime>({ interpreterProfiles: { snapshot } }),
  );

  await createAgentPlanService(planInput(agents));

  const [source] = vi.mocked(AgentPlanScripts).mock.calls[0];
  expect(getPagesRuntime).not.toHaveBeenCalled();
  await expect(source?.snapshot()).resolves.toEqual(opaque("interpreters"));
  expect(snapshot).toHaveBeenCalledOnce();
});

it("drives runs with the engine and reports engine activity to the runners", async () => {
  const { agents, attachRunOwnership } = agentFixture();

  await createAgentPlanService(planInput(agents));

  const sessions = only(vi.mocked(AgentPlanSessionAccess));
  const start = only(vi.mocked(AgentPlanStepStart));
  expect(vi.mocked(AgentPlanRunEngine).mock.calls[0][0]).toEqual({
    workGate: vi.mocked(AgentPlanWorkGate).mock.instances[0],
    remoteExecution: only(vi.mocked(AgentPlanRemoteExecution)),
    scripts: only(vi.mocked(AgentPlanScriptRunner)),
    runs: only(vi.mocked(AgentPlanRunRepository)),
    start,
    resources: agents.acpResourceScheduler,
    steps: only(vi.mocked(AgentPlanStepRunner)),
    archive: agents.agentRunArchive,
    files: agents.agentDefinitionFiles,
  });
  expect(vi.mocked(AgentPlanScriptRunner).mock.calls).toEqual([
    [only(vi.mocked(AgentPlanScriptPreparation))],
  ]);
  expect(vi.mocked(AgentPlanStepRunner).mock.calls[0][0]).toEqual({
    start,
    execution: agents.agentPlanExecution,
    tasks: vi.mocked(AgentPlanTasks).mock.instances[0],
    access: sessions,
    archive: agents.agentRunArchive,
    sessions: only(vi.mocked(AgentSessionService)),
  });
  expect(vi.mocked(AgentPlanSessionAccess).mock.calls[0]).toEqual([
    vi.mocked(AgentRunCredentialService).mock.instances[0],
    MCP,
  ]);
  expect(vi.mocked(AgentRunCredentialService).mock.calls[0]).toEqual([
    vi.mocked(AgentRunCredentialRepository).mock.instances[0],
  ]);
  vi.mocked(AgentPlanRunEngine.prototype.isActive).mockReturnValue(true);
  const [isActive] = attachRunOwnership.mock.calls[0];
  expect(isActive("run-1")).toBe(true);
  expect(AgentPlanRunEngine.prototype.isActive).toHaveBeenCalledWith("run-1");
});

it("lets runners reach Pages and run remote steps through the shared targets", async () => {
  const { agents } = agentFixture();

  await createAgentPlanService(planInput(agents));

  const targets = only(vi.mocked(AgentPlanRemoteTargets));
  const parameters = only(vi.mocked(AgentPlanRemoteParameters));
  const pages = only(vi.mocked(RunnerPagesAccessService));
  const runs = only(vi.mocked(AgentPlanRunRepository));
  expect(vi.mocked(AgentPlanRemoteTargets).mock.calls[0]).toEqual([
    agents.remoteWorkspaceService,
    agents.remoteConnectionService,
  ]);
  expect(vi.mocked(AgentPlanRemoteParameters).mock.calls[0][0]).toEqual({
    targets,
    tickets: agents.agentTicketParameterService,
    content: agents.agentContentAccess,
    assets: agents.agentTicketAssetService,
    authorization: vi.mocked(AuthorizationRepository).mock.instances[2],
    users: USERS,
  });
  expect(vi.mocked(RunnerPagesAccessService).mock.calls[0][0]).toEqual({
    parameters,
    runs,
    plans: ACCESS,
    runners: agents.runnerService,
    credentials: vi.mocked(AgentRunCredentialService).mock.instances[1],
    evidence: only(vi.mocked(AgentPlanRemoteAccessRepository)),
    api: API,
  });
  expect(vi.mocked(AgentPlanRemoteExecution).mock.calls[0][0]).toEqual({
    tasks: vi.mocked(AgentPlanTasks).mock.instances[1],
    parameters,
    pages,
    targets,
    access: ACCESS,
    runners: agents.runnerService,
    provider: agents.runnerOpenRouterService,
    runs,
  });
  expect(RunnerPagesAccessService.prototype.recover).toHaveBeenCalledOnce();
});

it("recovers interrupted session deliveries before the node sessions start", async () => {
  const { agents } = agentFixture();

  await createAgentPlanService(planInput(agents));

  const store = only(vi.mocked(AgentSessionRepository));
  const journal = only(vi.mocked(AgentSessionJournal));
  const inbox = only(vi.mocked(AgentSessionInbox));
  expect(vi.mocked(AgentSessionRepository).mock.calls).toEqual([[DATABASE]]);
  expect(vi.mocked(AgentSessionJournal).mock.calls).toEqual([[store]]);
  expect(vi.mocked(AgentSessionInbox).mock.calls).toEqual([[store, journal]]);
  expect(AgentSessionInbox.prototype.recover).toHaveBeenCalledOnce();
  expect(
    vi.mocked(AgentSessionInbox.prototype.recover).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(AgentSessionService).mock.invocationCallOrder[0]);
  expect(vi.mocked(AgentSessionService).mock.calls[0][0]).toMatchObject({
    store,
    journal,
    inbox,
  });
});

it("lets node sessions start and stop runs through the plan service", async () => {
  const { agents } = agentFixture();
  await createAgentPlanService(planInput(agents));
  vi.mocked(AgentPlanService.prototype.run).mockResolvedValue(opaque("run"));
  vi.mocked(AgentPlanService.prototype.stop).mockResolvedValue(opaque("stop"));

  const [{ runs }] = vi.mocked(AgentSessionService).mock.calls[0];

  await expect(runs.run("user-1", "run-1")).resolves.toEqual(opaque("run"));
  await expect(runs.stop("user-1", "run-2")).resolves.toEqual(opaque("stop"));
  expect(AgentPlanService.prototype.run).toHaveBeenCalledWith(
    "user-1",
    "run-1",
  );
  expect(AgentPlanService.prototype.stop).toHaveBeenCalledWith(
    "user-1",
    "run-2",
  );
  expect(vi.mocked(AgentPlanService.prototype.run).mock.contexts[0]).toBe(
    only(vi.mocked(AgentPlanService)),
  );
});

it("tells node sessions whether a run has a plan checkpoint", async () => {
  const { agents } = agentFixture();
  await createAgentPlanService(planInput(agents));
  vi.mocked(AgentPlanCheckpointRepository.prototype.find)
    .mockResolvedValueOnce(opaque("checkpoint"))
    .mockResolvedValueOnce(null);

  const [{ hasPlanCheckpoint }] = vi.mocked(AgentSessionService).mock.calls[0];

  await expect(hasPlanCheckpoint?.("run-1")).resolves.toBe(true);
  await expect(hasPlanCheckpoint?.("run-2")).resolves.toBe(false);
  expect(AgentPlanCheckpointRepository.prototype.find).toHaveBeenNthCalledWith(
    1,
    "run-1",
  );
});

it("tells node sessions whether exactly their step waits for capacity", async () => {
  const { agents, waiting } = agentFixture();
  waiting.push({ runId: "run-1", stepId: "step-1" });
  await createAgentPlanService(planInput(agents));

  const [{ isWaitingForCapacity }] =
    vi.mocked(AgentSessionService).mock.calls[0];

  expect(isWaitingForCapacity?.("run-1", "step-1")).toBe(true);
  expect(isWaitingForCapacity?.("run-1", "step-2")).toBe(false);
  expect(isWaitingForCapacity?.("run-2", "step-1")).toBe(false);
});

it("restarts, resumes and releases disturbed runs on the same parts", async () => {
  const { agents } = agentFixture();

  await createAgentPlanService(planInput(agents));

  expect(vi.mocked(AgentPlanRecoveryService).mock.calls[0][0]).toEqual({
    runs: only(vi.mocked(AgentPlanService)),
    recovery: only(vi.mocked(AgentPlanRecoveryRepository)),
    cleanupFailures: only(vi.mocked(AgentPlanCleanupFailureRepository)),
    checkpoints: vi.mocked(AgentPlanCheckpointRepository).mock.instances[0],
    execution: {
      access: ACCESS,
      preparation: only(vi.mocked(AgentPlanPreparation)),
      engine: only(vi.mocked(AgentPlanRunEngine)),
      remoteExecution: only(vi.mocked(AgentPlanRemoteExecution)),
      planRuns: only(vi.mocked(AgentPlanRunRepository)),
      resources: agents.acpResourceScheduler,
      executions: only(vi.mocked(AgentPlanRecoveryExecutionRepository)),
    },
  });
});

it("records interrupted runs, then repairs definition files and run records", async () => {
  const { agents, restore, recoverArchive } = agentFixture();

  await createAgentPlanService(planInput(agents));

  expect(
    AgentPlanService.prototype.recoverInterruptedRuns,
  ).toHaveBeenCalledWith(new Set(["instance-1"]));
  expect(restore).toHaveBeenCalledWith([opaque("profile")]);
  expect(recoverArchive).toHaveBeenCalledOnce();
  const recorded = vi.mocked(AgentPlanService.prototype.recoverInterruptedRuns)
    .mock.invocationCallOrder[0];
  expect(recorded).toBeLessThan(restore.mock.invocationCallOrder[0]);
  expect(restore.mock.invocationCallOrder[0]).toBeLessThan(
    recoverArchive.mock.invocationCallOrder[0],
  );
  expect(logCaughtError).not.toHaveBeenCalled();
});

it("reports unreadable agents and still recovers the run records", async () => {
  const { agents, restore, recoverArchive } = agentFixture();
  const failure = new Error("profiles unavailable");
  vi.mocked(AgentProfileRepository.prototype.list).mockRejectedValue(failure);

  await expect(
    createAgentPlanService(planInput(agents)),
  ).resolves.toBeDefined();

  expect(restore).not.toHaveBeenCalled();
  expect(logCaughtError).toHaveBeenCalledWith("agent_plan_services", failure);
  expect(logDiagnostic).toHaveBeenCalledWith(
    "agent_plan_services",
    "error",
    "Pages could not read the agents to repair their definition files.",
    failure,
  );
  expect(recoverArchive).toHaveBeenCalledOnce();
});
