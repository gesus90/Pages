import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRunsServices } from "./RunsServices";

interface Deferred {
  work: () => Promise<void>;
}

const mocks = vi.hoisted(() => ({
  contexts: [] as string[],
  getPagesRuntime: vi.fn(),
  databaseConnect: vi.fn(),
  databaseClose: vi.fn(),
  claimRunsProcessing: vi.fn(),
  resolveGitHubTokenKey: vi.fn(),
  resolveAgentsDirectory: vi.fn(),
  createPlanFoundation: vi.fn(),
  createPlanAgentServices: vi.fn(),
  createPlanProcessingServices: vi.fn(),
  startPlanRunRecorders: vi.fn(),
  planMcpSettings: vi.fn(),
  interruptedAcpOwners: vi.fn(),
  registerShutdownTask: vi.fn(),
  runShutdownSteps: vi.fn(),
  closeDatabaseForShutdown: vi.fn(),
  throwShutdownFailures: vi.fn(),
  unfinished: vi.fn(),
  reserving: vi.fn(),
  runRepositoryDatabases: [] as unknown[],
  healthDatabases: [] as unknown[],
}));

vi.mock("@/backend/database/executor/DatabaseWorkContext", () => ({
  withBackgroundDatabaseWork: <Result>(
    origin: string,
    work: () => Promise<Result>,
  ): Promise<Result> => {
    mocks.contexts.push(origin);
    return work();
  },
}));
vi.mock("./PagesRuntime", () => ({ getPagesRuntime: mocks.getPagesRuntime }));
vi.mock("./ProcessLifecycle", () => ({
  registerShutdownTask: mocks.registerShutdownTask,
}));
vi.mock("./ShutdownSteps", () => ({
  SHUTDOWN_LIMITS: { deadlineMs: 80_000 },
  runShutdownSteps: mocks.runShutdownSteps,
  closeDatabaseForShutdown: mocks.closeDatabaseForShutdown,
  throwShutdownFailures: mocks.throwShutdownFailures,
}));
vi.mock("@/backend/database/Database", () => ({
  Database: { connect: mocks.databaseConnect },
}));
vi.mock("@/backend/database/repositories/agent/AgentPlanRunRepository", () => ({
  AgentPlanRunRepository: class {
    public readonly unfinished = mocks.unfinished;
    public readonly reserving = mocks.reserving;
    public constructor(database: unknown) {
      mocks.runRepositoryDatabases.push(database);
    }
  },
}));
vi.mock("@/backend/service/HealthService", () => ({
  HealthService: class {
    public constructor(database: unknown) {
      mocks.healthDatabases.push(database);
    }
  },
}));
vi.mock("@/backend/config/PagesConfig", () => ({
  resolveAgentsDirectory: mocks.resolveAgentsDirectory,
}));
vi.mock("@/backend/github/GitHubTokenKey", () => ({
  resolveGitHubTokenKey: mocks.resolveGitHubTokenKey,
}));
vi.mock("@/backend/service/agents/AgentPlanRecovery", () => ({
  interruptedAcpOwners: mocks.interruptedAcpOwners,
}));
vi.mock("@/backend/service/agents/runs/RunsProcessing", () => ({
  claimRunsProcessing: mocks.claimRunsProcessing,
}));
vi.mock("@/app/lib/plan-foundation.server", () => ({
  createPlanFoundation: mocks.createPlanFoundation,
}));
vi.mock("@/app/lib/plan-agent-services.server", () => ({
  createPlanAgentServices: mocks.createPlanAgentServices,
}));
vi.mock("@/app/lib/agent-plan-services.server", () => ({
  createPlanProcessingServices: mocks.createPlanProcessingServices,
}));
vi.mock("@/app/lib/plan-run-recorders.server", () => ({
  startPlanRunRecorders: mocks.startPlanRunRecorders,
}));
vi.mock("@/app/lib/bridge-settings.server", () => ({
  planMcpSettings: mocks.planMcpSettings,
}));

const DATABASE = { name: "database", close: mocks.databaseClose };
const DATABASE_PATH = "/var/lib/pages/data/pages.db";
const CONFIG_PATH = "/etc/pages/config.toml";
const CONFIG = { port: 3100, agentGitBridges: ["bridge"] };
const TOKEN_KEY = Buffer.from("token-key");
const FOUNDATION = {
  ticketAssets: "ticket-assets",
  events: "events",
  tasks: "tasks",
  users: "users",
};

interface AgentStubOptions {
  readonly hasLocalSessions: boolean;
}

const agentCalls: string[] = [];

function createAgents(options: AgentStubOptions): Record<string, unknown> {
  const record = (name: string): (() => Promise<void>) =>
    vi.fn(async () => {
      agentCalls.push(name);
    });
  return {
    localSessions: options.hasLocalSessions
      ? {
          discover: vi.fn(async () => ({
            adopted: ["adopted"],
            uncertain: ["uncertain"],
          })),
          settleFinished: record("settleFinished"),
          detachAll: vi.fn(() => {
            agentCalls.push("detachAll");
          }),
        }
      : undefined,
    agentCliGitHubCredentials: {
      recover: vi.fn(async () => [{ instanceId: "left-1" }]),
    },
    acpResourceScheduler: {
      recover: record("acpRecover"),
      shutdown: record("acpShutdown"),
    },
    agentToolManagerService: { shutdown: record("toolShutdown") },
    closeClients: record("closeClients"),
  };
}

function runtimeWith(databaseUrl: string | null): Record<string, unknown> {
  return {
    getDatabaseUrl: () => databaseUrl,
    getDatabasePath: () => DATABASE_PATH,
    getConfig: () => CONFIG,
    configFile: { path: CONFIG_PATH },
  };
}

function registeredTask(): Deferred & { options: Record<string, unknown> } {
  const [work, options] = mocks.registerShutdownTask.mock.calls[0] as [
    () => Promise<void>,
    Record<string, unknown>,
  ];
  return { work, options };
}

function processingInput(): Record<string, unknown> {
  const input: unknown = mocks.createPlanProcessingServices.mock.calls[0]?.[0];
  if (typeof input !== "object" || input === null) {
    throw new Error("Plan processing was not created");
  }
  return Object.fromEntries(Object.entries(input));
}

function callProcessingHook(name: string, ...args: unknown[]): unknown {
  const hook = processingInput()[name];
  if (typeof hook !== "function") throw new Error(`No hook ${name}`);
  return hook(...args);
}

async function openWith(
  agents: Record<string, unknown>,
  databaseUrl: string | null = "postgres://pages",
): Promise<unknown> {
  mocks.getPagesRuntime.mockResolvedValue(runtimeWith(databaseUrl));
  mocks.createPlanAgentServices.mockReturnValue(agents);
  return createRunsServices();
}

beforeEach(() => {
  agentCalls.length = 0;
  mocks.contexts.length = 0;
  mocks.runRepositoryDatabases.length = 0;
  mocks.healthDatabases.length = 0;
  mocks.databaseConnect.mockResolvedValue(DATABASE);
  mocks.databaseClose.mockResolvedValue(undefined);
  mocks.claimRunsProcessing.mockResolvedValue(undefined);
  mocks.resolveGitHubTokenKey.mockReturnValue(TOKEN_KEY);
  mocks.resolveAgentsDirectory.mockReturnValue("/var/lib/pages/agents");
  mocks.createPlanFoundation.mockReturnValue(FOUNDATION);
  mocks.createPlanProcessingServices.mockResolvedValue({
    marker: "processing",
    agentPlanService: {
      shutdown: vi.fn(async () => {
        agentCalls.push("planShutdown");
      }),
    },
  });
  mocks.planMcpSettings.mockReturnValue({ port: 3100 });
  mocks.unfinished.mockResolvedValue([{ id: "u1" }]);
  mocks.reserving.mockResolvedValue([{ id: "r1" }]);
  mocks.interruptedAcpOwners.mockReturnValue(["owner"]);
  mocks.runShutdownSteps.mockImplementation(
    async (steps: readonly Deferred[]) => {
      const failures: unknown[] = [];
      for (const step of steps) {
        try {
          await step.work();
        } catch (error: unknown) {
          failures.push(error);
        }
      }
      return failures;
    },
  );
  mocks.closeDatabaseForShutdown.mockImplementation(
    async (close: () => Promise<void>) => {
      await close();
      return null;
    },
  );
});

describe("createRunsServices startup", () => {
  it("opens the database, claims runs processing and wires the plan services", async () => {
    const agents = createAgents({ hasLocalSessions: true });

    const services = await openWith(agents);

    expect(mocks.contexts).toEqual(["runs_startup"]);
    expect(mocks.databaseConnect).toHaveBeenCalledWith(
      "postgres://pages",
      path.dirname(DATABASE_PATH),
    );
    expect(mocks.claimRunsProcessing).toHaveBeenCalledWith(CONFIG);
    expect(mocks.resolveGitHubTokenKey).toHaveBeenCalledWith(DATABASE_PATH);
    expect(mocks.createPlanFoundation).toHaveBeenCalledWith({
      database: DATABASE,
      databasePath: DATABASE_PATH,
      tokenKey: TOKEN_KEY,
    });
    expect(mocks.createPlanAgentServices).toHaveBeenCalledWith(
      DATABASE,
      path.dirname(DATABASE_PATH),
      TOKEN_KEY,
      {
        agentsDirectory: "/var/lib/pages/agents",
        configPath: CONFIG_PATH,
        recoveryScope: "plans",
        acpOptions: CONFIG,
        gitBridges: ["bridge"],
        ticketAssets: "ticket-assets",
        events: "events",
      },
    );
    expect(mocks.resolveAgentsDirectory).toHaveBeenCalledWith(CONFIG_PATH);
    expect(mocks.planMcpSettings).toHaveBeenCalledWith(3100);
    expect(processingInput()).toMatchObject({
      database: DATABASE,
      agents,
      tasks: "tasks",
      users: "users",
      mcp: { port: 3100 },
    });
    expect(services).toMatchObject({ marker: "processing" });
    expect(mocks.healthDatabases).toEqual([DATABASE]);
    expect(services).toHaveProperty("healthService");
  });

  it("refuses to start without a PostgreSQL URL", async () => {
    await expect(
      openWith(createAgents({ hasLocalSessions: true }), null),
    ).rejects.toThrow("pages-runs requires PostgreSQL");

    expect(mocks.databaseConnect).not.toHaveBeenCalled();
    expect(mocks.claimRunsProcessing).not.toHaveBeenCalled();
    expect(mocks.registerShutdownTask).not.toHaveBeenCalled();
  });

  it("does not create any service when another process owns the runs", async () => {
    mocks.claimRunsProcessing.mockRejectedValue(new Error("already claimed"));

    await expect(
      openWith(createAgents({ hasLocalSessions: true })),
    ).rejects.toThrow("already claimed");

    expect(mocks.createPlanFoundation).not.toHaveBeenCalled();
    expect(mocks.registerShutdownTask).not.toHaveBeenCalled();
  });

  it("starts the run recorders before recovery with the stored configuration", async () => {
    await openWith(createAgents({ hasLocalSessions: true }));
    mocks.startPlanRunRecorders.mockReturnValue("recorders");

    const result = callProcessingHook("beforeRecovery", "dependencies");

    expect(result).toBe("recorders");
    expect(mocks.startPlanRunRecorders).toHaveBeenCalledWith(
      DATABASE,
      "dependencies",
      CONFIG,
    );
  });

  it("keeps the Agent API out of the standalone scheduler", async () => {
    await openWith(createAgents({ hasLocalSessions: true }));

    await expect(callProcessingHook("api")).rejects.toThrow(
      "The Agent API belongs to the API process",
    );
  });
});

describe("createRunsServices recovery", () => {
  it("recovers sessions, credentials and ACP resources before the services start", async () => {
    const agents = createAgents({ hasLocalSessions: true });
    mocks.createPlanProcessingServices.mockImplementation(async () => {
      agentCalls.push("processing");
      return { agentPlanService: { shutdown: vi.fn() } };
    });

    await openWith(agents);

    const credentials = agents.agentCliGitHubCredentials as {
      recover: ReturnType<typeof vi.fn>;
    };
    const scheduler = agents.acpResourceScheduler as {
      recover: ReturnType<typeof vi.fn>;
    };
    expect(credentials.recover).toHaveBeenCalledWith(
      ["adopted"],
      ["uncertain"],
    );
    expect(mocks.runRepositoryDatabases).toEqual([DATABASE]);
    expect(mocks.interruptedAcpOwners).toHaveBeenCalledWith(
      [{ id: "u1" }, { id: "r1" }],
      ["adopted"],
    );
    expect(scheduler.recover).toHaveBeenCalledWith(
      ["owner"],
      new Set(["left-1"]),
      ["adopted"],
      ["uncertain"],
    );
    expect(agentCalls).toEqual(["acpRecover", "settleFinished", "processing"]);
  });

  it("recovers without local sessions", async () => {
    const agents = createAgents({ hasLocalSessions: false });

    await openWith(agents);

    const credentials = agents.agentCliGitHubCredentials as {
      recover: ReturnType<typeof vi.fn>;
    };
    const scheduler = agents.acpResourceScheduler as {
      recover: ReturnType<typeof vi.fn>;
    };
    expect(credentials.recover).toHaveBeenCalledWith(undefined, undefined);
    expect(mocks.interruptedAcpOwners).toHaveBeenCalledWith(
      [{ id: "u1" }, { id: "r1" }],
      undefined,
    );
    expect(scheduler.recover).toHaveBeenCalledWith(
      ["owner"],
      new Set(["left-1"]),
      undefined,
      undefined,
    );
    expect(agentCalls).toEqual(["acpRecover"]);
  });
});

describe("createRunsServices shutdown task", () => {
  it("is registered with the full deadline as its budget", async () => {
    await openWith(createAgents({ hasLocalSessions: true }));

    expect(mocks.registerShutdownTask).toHaveBeenCalledTimes(1);
    expect(registeredTask().options).toEqual({
      step: "runs_services",
      budgetMs: 80_000,
    });
  });

  it("detaches local sessions, stops the services in order and closes the database", async () => {
    await openWith(createAgents({ hasLocalSessions: true }));
    agentCalls.length = 0;

    await registeredTask().work();

    expect(agentCalls).toEqual([
      "detachAll",
      "planShutdown",
      "acpShutdown",
      "toolShutdown",
      "closeClients",
    ]);
    const stepNames = (
      mocks.runShutdownSteps.mock.calls[0]?.[0] as readonly { step: string }[]
    ).map((entry) => entry.step);
    expect(stepNames).toEqual([
      "plans",
      "acp_resources",
      "tool_manager",
      "plan_agent_clients",
    ]);
    expect(mocks.databaseClose).toHaveBeenCalledTimes(1);
    expect(mocks.throwShutdownFailures).toHaveBeenCalledWith([]);
  });

  it("stops without local sessions to detach", async () => {
    await openWith(createAgents({ hasLocalSessions: false }));
    agentCalls.length = 0;

    await registeredTask().work();

    expect(agentCalls).not.toContain("detachAll");
    expect(mocks.databaseClose).toHaveBeenCalledTimes(1);
  });

  it("still closes the database after a failed step and passes on every failure", async () => {
    const stepFailure = new Error("plans stuck");
    const closeFailure = new Error("checkpoint failed");
    mocks.createPlanProcessingServices.mockResolvedValue({
      agentPlanService: {
        shutdown: vi.fn(() => Promise.reject(stepFailure)),
      },
    });
    mocks.closeDatabaseForShutdown.mockResolvedValue(closeFailure);
    await openWith(createAgents({ hasLocalSessions: true }));

    await registeredTask().work();

    expect(mocks.closeDatabaseForShutdown).toHaveBeenCalledTimes(1);
    expect(mocks.throwShutdownFailures).toHaveBeenCalledWith([
      stepFailure,
      closeFailure,
    ]);
  });

  it("passes on only the step failures when the database closed", async () => {
    const stepFailure = new Error("clients stuck");
    const agents = createAgents({ hasLocalSessions: true });
    agents.closeClients = vi.fn(() => Promise.reject(stepFailure));
    await openWith(agents);

    await registeredTask().work();

    expect(mocks.throwShutdownFailures).toHaveBeenCalledWith([stepFailure]);
  });
});
