import { beforeEach, expect, it, vi } from "vitest";

import { logEvent } from "@/backend/logging/Logger";
import {
  canProcessIntegrations,
  claimIntegrationProcessing,
  stopIntegrationProcessing,
} from "@/backend/service/integrations/IntegrationProcessing";

import { startIntegrations } from "./IntegrationsEntry";
import { registerShutdownTask, shutdownProcess } from "./ProcessLifecycle";
import { hasServiceProgress } from "./ServiceWorkHealth";
import { startServiceWatchdog } from "./ServiceWatchdog";

const mocks = vi.hoisted(() => ({
  readConfig: vi.fn(),
  constructed: [] as unknown[][],
  githubStart: vi.fn(),
  githubStop: vi.fn(),
  fcmStart: vi.fn(),
  fcmStop: vi.fn(),
  database: { close: vi.fn(), query: vi.fn() },
  forwardLiveChanges: vi.fn(),
  createServices: vi.fn(),
  createRunAccess: vi.fn(),
  createFcm: vi.fn(),
  resolveTokenKey: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@/backend/config/ConfigFile", () => ({
  ConfigFile: class ConfigFile {
    public readonly read = mocks.readConfig;
  },
}));
vi.mock("@/backend/config/PagesConfig", () => ({
  resolveAgentsDirectory: vi.fn((configPath: string) => `${configPath}.agents`),
}));
vi.mock("@/backend/database/Database", () => ({
  Database: { connect: mocks.connect },
}));
vi.mock(
  "@/backend/database/repositories/integrations/GitHubJobRepository",
  () => ({
    GitHubJobRepository: class GitHubJobRepository {
      public constructor(...args: unknown[]) {
        mocks.constructed.push(["jobs", ...args]);
      }
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/LiveChangeNotificationRepository",
  () => ({
    LiveChangeNotificationRepository: class LiveChangeNotificationRepository {
      public constructor(...args: unknown[]) {
        mocks.constructed.push(["notifications", ...args]);
      }
    },
  }),
);
vi.mock("@/backend/github/GitHubTokenKey", () => ({
  resolveGitHubTokenKey: mocks.resolveTokenKey,
}));
vi.mock("@/backend/logging/Logger", () => ({
  initializeLogging: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock("@/backend/service/integrations/GitHubJobWorker", () => ({
  GitHubJobWorker: class GitHubJobWorker {
    public readonly start = mocks.githubStart;
    public readonly stop = mocks.githubStop;

    public constructor(...args: unknown[]) {
      mocks.constructed.push(["worker", ...args]);
    }
  },
}));
vi.mock("@/backend/service/events/PagesEventPublisher", () => ({
  PagesEventPublisher: class PagesEventPublisher {
    public constructor(...args: unknown[]) {
      mocks.constructed.push(["events", ...args]);
    }
  },
}));
vi.mock("@/backend/service/events/LiveChangeRelay", () => ({
  forwardLiveChanges: mocks.forwardLiveChanges,
}));
vi.mock("@/backend/service/integrations/IntegrationServices", () => ({
  createIntegrationServices: mocks.createServices,
}));
vi.mock("@/backend/service/integrations/IntegrationRunAccess", () => ({
  createIntegrationRunAccess: mocks.createRunAccess,
}));
vi.mock("@/backend/service/integrations/IntegrationFcmConsumer", () => ({
  createIntegrationFcmConsumer: mocks.createFcm,
}));
vi.mock("@/backend/service/integrations/IntegrationProcessing", () => ({
  canProcessIntegrations: vi.fn(),
  claimIntegrationProcessing: vi.fn(),
  stopIntegrationProcessing: vi.fn(),
}));
vi.mock("./ProcessLifecycle", () => ({
  installProcessLogging: vi.fn(),
  registerShutdownTask: vi.fn(),
  shutdownProcess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./ServiceWorkHealth", () => ({ hasServiceProgress: vi.fn() }));
vi.mock("./ServiceWatchdog", () => ({ startServiceWatchdog: vi.fn() }));

const CONFIG_PATH = "/etc/pages/config.toml";
const ARGUMENTS = ["--config", CONFIG_PATH];
const READY_CONFIG = {
  firstRun: false,
  databaseUrl: "postgres://pages.test/db",
  databasePath: "/var/pages/data/pages.db",
  integrationsMode: "separate",
};
const SERVICES = {
  github: "github-service",
  userRepository: "user-repository",
  tasks: "tasks",
  users: "users",
};

function expectFatalStart(): void {
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      level: "fatal",
      event: "integrations.start.failed",
    }),
  );
  expect(shutdownProcess).toHaveBeenCalledWith(1, "integrations_startup");
  expect(registerShutdownTask).not.toHaveBeenCalled();
}

beforeEach(() => {
  mocks.constructed = [];
  mocks.readConfig.mockResolvedValue(READY_CONFIG);
  mocks.githubStart.mockResolvedValue(undefined);
  mocks.githubStop.mockResolvedValue(undefined);
  mocks.fcmStop.mockResolvedValue(undefined);
  mocks.database.close.mockResolvedValue(undefined);
  mocks.database.query.mockResolvedValue(undefined);
  mocks.resolveTokenKey.mockReturnValue("token-key");
  mocks.createServices.mockReturnValue(SERVICES);
  mocks.createRunAccess.mockReturnValue("runs");
  mocks.createFcm.mockReturnValue({
    start: mocks.fcmStart,
    stop: mocks.fcmStop,
  });
  vi.mocked(claimIntegrationProcessing).mockResolvedValue(true);
  mocks.connect.mockResolvedValue(mocks.database);
});

it("starts delivery workers on the owned database and logs the start", async () => {
  await startIntegrations(ARGUMENTS);

  expect(shutdownProcess).not.toHaveBeenCalled();
  expect(claimIntegrationProcessing).toHaveBeenCalledWith(
    READY_CONFIG,
    "separate",
  );
  expect(mocks.connect).toHaveBeenCalledWith(
    READY_CONFIG.databaseUrl,
    "/var/pages/data",
  );
  expect(mocks.resolveTokenKey).toHaveBeenCalledWith(
    READY_CONFIG.databasePath,
    { allowCreate: false },
  );
  const serviceCall = mocks.createServices.mock.calls[0];
  expect(serviceCall?.slice(0, 3)).toEqual([
    mocks.database,
    "/var/pages/data",
    "token-key",
  ]);
  expect(serviceCall?.[3]).toHaveProperty("events");
  expect(mocks.createRunAccess).toHaveBeenCalledWith(
    expect.objectContaining({
      agentsDirectory: `${CONFIG_PATH}.agents`,
      tokenKey: "token-key",
      services: SERVICES,
    }),
  );
  expect(mocks.forwardLiveChanges).toHaveBeenCalledOnce();
  const worker = mocks.constructed.find((entry) => entry[0] === "worker");
  expect(worker?.[1]).toMatchObject({
    github: "github-service",
    users: "user-repository",
    tasks: "tasks",
  });
  expect(worker?.[1]).toHaveProperty("jobs");
  expect(mocks.githubStart).toHaveBeenCalledOnce();
  expect(mocks.fcmStart).toHaveBeenCalledOnce();
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ event: "integrations.started" }),
  );
});

it("drains workers, then closes the database at shutdown", async () => {
  await startIntegrations(ARGUMENTS);
  const call = vi.mocked(registerShutdownTask).mock.calls[0];

  await call?.[0]();

  expect(call?.[1]).toEqual({ step: "integrations_drain", budgetMs: 25_000 });
  expect(stopIntegrationProcessing).toHaveBeenCalledOnce();
  expect(mocks.githubStop).toHaveBeenCalledOnce();
  expect(mocks.fcmStop).toHaveBeenCalledOnce();
  expect(mocks.database.close).toHaveBeenCalledOnce();
});

async function runProbe(): Promise<boolean> {
  await startIntegrations(ARGUMENTS);
  const probe = vi.mocked(startServiceWatchdog).mock.calls[0]?.[0];
  if (!probe) throw new Error("watchdog was not started");
  return probe();
}

it("reports the service alive when it may process and both workers progressed", async () => {
  vi.mocked(canProcessIntegrations).mockReturnValue(true);
  vi.mocked(hasServiceProgress).mockReturnValue(true);

  await expect(runProbe()).resolves.toBe(true);

  expect(hasServiceProgress).toHaveBeenCalledWith([
    "integrations.github",
    "integrations.fcm",
  ]);
  expect(mocks.database.query).toHaveBeenCalledWith("SELECT 1 AS alive;");
});

it("reports the service unhealthy without a database probe once ownership is lost", async () => {
  vi.mocked(canProcessIntegrations).mockReturnValue(false);

  await expect(runProbe()).resolves.toBe(false);

  expect(mocks.database.query).not.toHaveBeenCalled();
});

it("reports the service unhealthy when a worker made no progress", async () => {
  vi.mocked(canProcessIntegrations).mockReturnValue(true);
  vi.mocked(hasServiceProgress).mockReturnValue(false);

  await expect(runProbe()).resolves.toBe(false);

  expect(mocks.database.query).not.toHaveBeenCalled();
});

it.each([
  { name: "no configuration file", config: null },
  { name: "an unfinished setup", config: { ...READY_CONFIG, firstRun: true } },
  { name: "no database URL", config: { ...READY_CONFIG, databaseUrl: "" } },
  {
    name: "the combined integrations mode",
    config: { ...READY_CONFIG, integrationsMode: "embedded" },
  },
])("refuses to start with $name", async ({ config }) => {
  mocks.readConfig.mockResolvedValue(config);

  await startIntegrations(ARGUMENTS);

  expectFatalStart();
  expect(claimIntegrationProcessing).not.toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
});

it("refuses to start when another process owns integration delivery", async () => {
  vi.mocked(claimIntegrationProcessing).mockResolvedValue(false);

  await startIntegrations(ARGUMENTS);

  expectFatalStart();
  expect(mocks.connect).not.toHaveBeenCalled();
});

it.each([
  { name: "no arguments", args: [] },
  { name: "a wrong option name", args: ["--cfg", CONFIG_PATH] },
  { name: "an extra argument", args: [...ARGUMENTS, "--extra"] },
  { name: "an empty path", args: ["--config", ""] },
  { name: "a relative path", args: ["--config", "config.toml"] },
])("refuses to start with $name", async ({ args }) => {
  await startIntegrations(args);

  expectFatalStart();
  expect(mocks.readConfig).not.toHaveBeenCalled();
});

it("ends the process when the database cannot be reached", async () => {
  mocks.connect.mockRejectedValue(new Error("ECONNREFUSED"));

  await startIntegrations(ARGUMENTS);

  expectFatalStart();
  expect(mocks.githubStart).not.toHaveBeenCalled();
});

it("ends the process when the GitHub worker cannot start", async () => {
  mocks.githubStart.mockRejectedValue(new Error("schema mismatch"));

  await startIntegrations(ARGUMENTS);

  expect(shutdownProcess).toHaveBeenCalledWith(1, "integrations_startup");
  expect(mocks.fcmStart).not.toHaveBeenCalled();
  expect(startServiceWatchdog).not.toHaveBeenCalled();
});
