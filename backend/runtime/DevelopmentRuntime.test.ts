import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import { beforeEach, expect, it, vi } from "vitest";

import { startDevelopmentRuntime } from "./DevelopmentRuntime";

import type { DevelopmentRequestLogger } from "./DevelopmentRuntime";

const mocks = vi.hoisted(() => ({
  resolveDefaultConfigPath: vi.fn(),
  logCaughtError: vi.fn(),
  initializeLogging: vi.fn(),
  installProcessLogging: vi.fn(),
  shutdownProcess: vi.fn(),
  startAgentTools: vi.fn(),
  announceServer: vi.fn(),
  initializePagesRuntime: vi.fn(),
  logRequest: vi.fn(),
}));

vi.mock("@/backend/config/PagesConfig", () => ({
  resolveDefaultConfigPath: mocks.resolveDefaultConfigPath,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  initializeLogging: mocks.initializeLogging,
}));
vi.mock("./ProcessLifecycle", () => ({
  installProcessLogging: mocks.installProcessLogging,
  shutdownProcess: mocks.shutdownProcess,
}));
vi.mock("./AgentToolsStartup", () => ({
  startAgentTools: mocks.startAgentTools,
}));
vi.mock("./PagesServer", () => ({ announceServer: mocks.announceServer }));
vi.mock("./PagesRuntime", () => ({
  initializePagesRuntime: mocks.initializePagesRuntime,
}));
vi.mock("./RequestLogging", () => ({ logRequest: mocks.logRequest }));

const CONFIG_PATH = "/home/user/.pages/config.toml";
const RUNTIME = Symbol("runtime");

beforeEach(() => {
  mocks.resolveDefaultConfigPath.mockReturnValue(CONFIG_PATH);
  mocks.initializeLogging.mockResolvedValue(undefined);
  mocks.initializePagesRuntime.mockResolvedValue(RUNTIME);
  mocks.shutdownProcess.mockResolvedValue(undefined);
  mocks.startAgentTools.mockResolvedValue(undefined);
});

it("initializes logging and runtime, warms tools and announces trimmed URLs", async () => {
  await startDevelopmentRuntime([
    "http://localhost:5173/",
    "http://192.168.1.5:5173",
  ]);

  expect(mocks.installProcessLogging).toHaveBeenCalledTimes(1);
  expect(mocks.initializeLogging).toHaveBeenCalledWith(CONFIG_PATH);
  expect(mocks.initializePagesRuntime).toHaveBeenCalledWith(CONFIG_PATH);
  expect(mocks.startAgentTools).toHaveBeenCalledWith(RUNTIME);
  expect(mocks.announceServer).toHaveBeenCalledWith(RUNTIME, [
    "http://localhost:5173",
    "http://192.168.1.5:5173",
  ]);
  expect(mocks.shutdownProcess).not.toHaveBeenCalled();
});

it("installs a request logger that forwards to the request logging", async () => {
  const installed: DevelopmentRequestLogger[] = [];
  await startDevelopmentRuntime([], (listener) => {
    installed.push(listener);
  });
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);
  const next = vi.fn();

  expect(installed).toHaveLength(1);
  installed[0]?.(request, response, next);

  expect(mocks.logRequest).toHaveBeenCalledWith(request, response, next);
});

it("shuts the process down with the startup error when initialization fails", async () => {
  const failure = new Error("runtime failed");
  mocks.initializePagesRuntime.mockRejectedValue(failure);
  const installRequests = vi.fn();

  await startDevelopmentRuntime(["http://localhost:5173/"], installRequests);

  expect(mocks.logCaughtError).toHaveBeenCalledWith(
    "DevelopmentRuntime",
    failure,
  );
  expect(mocks.shutdownProcess).toHaveBeenCalledWith(
    1,
    "development_startup",
    failure,
  );
  expect(installRequests).not.toHaveBeenCalled();
  expect(mocks.announceServer).not.toHaveBeenCalled();
});
