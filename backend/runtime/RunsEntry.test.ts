import { beforeEach, expect, it, vi } from "vitest";

import { startRuns } from "./RunsEntry";

const mocks = vi.hoisted(() => ({
  initializeLogging: vi.fn(),
  logEvent: vi.fn(),
  createRunsServices: vi.fn(),
  canProcessRuns: vi.fn(),
  enterRunsProcess: vi.fn(),
  hasServiceProgress: vi.fn(),
  startServiceWatchdog: vi.fn(),
  initializePagesRuntime: vi.fn(),
  installProcessLogging: vi.fn(),
  shutdownProcess: vi.fn(),
  canQueryDatabase: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => ({
  initializeLogging: mocks.initializeLogging,
  logEvent: mocks.logEvent,
}));
vi.mock("./RunsServices", () => ({
  createRunsServices: mocks.createRunsServices,
}));
vi.mock("./RunsMode", () => ({
  canProcessRuns: mocks.canProcessRuns,
  enterRunsProcess: mocks.enterRunsProcess,
}));
vi.mock("./ServiceWorkHealth", () => ({
  hasServiceProgress: mocks.hasServiceProgress,
}));
vi.mock("./ServiceWatchdog", () => ({
  startServiceWatchdog: mocks.startServiceWatchdog,
}));
vi.mock("./PagesRuntime", () => ({
  initializePagesRuntime: mocks.initializePagesRuntime,
}));
vi.mock("./ProcessLifecycle", () => ({
  installProcessLogging: mocks.installProcessLogging,
  shutdownProcess: mocks.shutdownProcess,
}));

const CONFIG_PATH = "/etc/pages/config.toml";
const VALID_ARGUMENTS = ["--config", CONFIG_PATH];
const READY_CONFIG = {
  firstRun: false,
  databaseUrl: "postgres://pages.invalid/pages",
  runsMode: "separate",
};

function provideConfig(config: Record<string, unknown>): void {
  mocks.initializePagesRuntime.mockResolvedValue({
    getConfig: (): Record<string, unknown> => config,
  });
}

function shutdownError(): unknown {
  return mocks.shutdownProcess.mock.calls[0]?.[2];
}

async function readWatchdogProbe(): Promise<() => Promise<boolean>> {
  await startRuns(VALID_ARGUMENTS);
  const probe: unknown = mocks.startServiceWatchdog.mock.calls[0]?.[0];
  if (typeof probe !== "function") throw new Error("No watchdog probe.");

  return async (): Promise<boolean> => {
    const result: unknown = await probe();

    return result === true;
  };
}

beforeEach(() => {
  provideConfig(READY_CONFIG);
  mocks.createRunsServices.mockResolvedValue({
    healthService: { canQueryDatabase: mocks.canQueryDatabase },
  });
  mocks.shutdownProcess.mockResolvedValue(undefined);
  mocks.initializeLogging.mockResolvedValue(undefined);
  mocks.canProcessRuns.mockReturnValue(true);
  mocks.hasServiceProgress.mockReturnValue(true);
  mocks.canQueryDatabase.mockResolvedValue(true);
});

it("starts the standalone scheduler for a completed separate setup", async () => {
  await startRuns(VALID_ARGUMENTS);

  expect(mocks.installProcessLogging).toHaveBeenCalledTimes(1);
  expect(mocks.enterRunsProcess).toHaveBeenCalledTimes(1);
  expect(mocks.initializeLogging).toHaveBeenCalledWith(CONFIG_PATH);
  expect(mocks.initializePagesRuntime).toHaveBeenCalledWith(CONFIG_PATH);
  expect(mocks.createRunsServices).toHaveBeenCalledTimes(1);
  expect(mocks.startServiceWatchdog).toHaveBeenCalledTimes(1);
  expect(mocks.logEvent).toHaveBeenCalledWith({
    level: "info",
    event: "runs.started",
    component: "RunsEntry",
    message: "Standalone plan engine and command inbox started",
  });
  expect(mocks.shutdownProcess).not.toHaveBeenCalled();
});

it("marks the runs process before logging and runtime are initialized", async () => {
  const order: string[] = [];
  mocks.enterRunsProcess.mockImplementation(() => order.push("enter"));
  mocks.initializeLogging.mockImplementation(() => {
    order.push("logging");

    return Promise.resolve();
  });

  await startRuns(VALID_ARGUMENTS);

  expect(order).toEqual(["enter", "logging"]);
});

it("reports a healthy watchdog probe when work, progress and database are fine", async () => {
  const probe = await readWatchdogProbe();

  expect(await probe()).toBe(true);
  expect(mocks.hasServiceProgress).toHaveBeenCalledWith(["runs.commands"]);
});

it("fails the probe and skips the database when this process may not process runs", async () => {
  const probe = await readWatchdogProbe();
  mocks.canProcessRuns.mockReturnValue(false);

  expect(await probe()).toBe(false);
  expect(mocks.hasServiceProgress).not.toHaveBeenCalled();
  expect(mocks.canQueryDatabase).not.toHaveBeenCalled();
});

it("fails the probe and skips the database when the command inbox made no progress", async () => {
  const probe = await readWatchdogProbe();
  mocks.hasServiceProgress.mockReturnValue(false);

  expect(await probe()).toBe(false);
  expect(mocks.canQueryDatabase).not.toHaveBeenCalled();
});

it("fails the probe when the database cannot be queried", async () => {
  const probe = await readWatchdogProbe();
  mocks.canQueryDatabase.mockResolvedValue(false);

  expect(await probe()).toBe(false);
});

it.each([
  ["no arguments", []],
  ["a missing path", ["--config"]],
  ["a wrong flag", ["--settings", CONFIG_PATH]],
  ["an empty path", ["--config", ""]],
  ["a relative path", ["--config", "config.toml"]],
  ["a surplus argument", ["--config", CONFIG_PATH, "--verbose"]],
])("shuts down with a usage error for %s", async (caseName, argumentList) => {
  await startRuns(argumentList);

  expect(mocks.shutdownProcess).toHaveBeenCalledWith(
    1,
    "runs_startup",
    expect.any(Error),
  );
  expect(shutdownError()).toMatchObject({
    message: "Usage: node pages-runs.mjs --config /absolute/config.toml",
  });
  expect(mocks.enterRunsProcess).not.toHaveBeenCalled();
  expect(mocks.initializePagesRuntime).not.toHaveBeenCalled();
});

it.each([
  ["setup is still pending", { ...READY_CONFIG, firstRun: true }],
  ["the database url is missing", { ...READY_CONFIG, databaseUrl: undefined }],
  ["the database url is empty", { ...READY_CONFIG, databaseUrl: "" }],
  ["the runs mode is combined", { ...READY_CONFIG, runsMode: "combined" }],
])("refuses to start when %s", async (caseName, config) => {
  provideConfig(config);

  await startRuns(VALID_ARGUMENTS);

  expect(shutdownError()).toMatchObject({
    message: "pages-runs requires completed setup and runsMode = separate.",
  });
  expect(mocks.shutdownProcess).toHaveBeenCalledWith(
    1,
    "runs_startup",
    expect.any(Error),
  );
  expect(mocks.createRunsServices).not.toHaveBeenCalled();
  expect(mocks.startServiceWatchdog).not.toHaveBeenCalled();
});

it("shuts down with the error of a failing runtime initialization", async () => {
  const failure = new Error("database unreachable");
  mocks.initializePagesRuntime.mockRejectedValue(failure);

  await startRuns(VALID_ARGUMENTS);

  expect(mocks.shutdownProcess).toHaveBeenCalledWith(
    1,
    "runs_startup",
    failure,
  );
  expect(mocks.logEvent).not.toHaveBeenCalled();
});

it("shuts down with the error of failing service creation", async () => {
  const failure = new Error("services failed");
  mocks.createRunsServices.mockRejectedValue(failure);

  await startRuns(VALID_ARGUMENTS);

  expect(mocks.shutdownProcess).toHaveBeenCalledWith(
    1,
    "runs_startup",
    failure,
  );
  expect(mocks.startServiceWatchdog).not.toHaveBeenCalled();
});
