import { beforeEach, describe, expect, it, vi } from "vitest";

import { MissingDatabaseUrlError } from "@/backend/config/PagesConfig";

import { startServer } from "./ServerEntry";

import type * as PagesConfigModule from "@/backend/config/PagesConfig";
import type { PagesServerOptions } from "./PagesServer";

const mocks = vi.hoisted(() => ({
  parseStartOptions: vi.fn(),
  resolveDefaultConfigPath: vi.fn(),
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  initializeLogging: vi.fn(),
  closeLogging: vi.fn(),
  logEvent: vi.fn(),
  startPagesServer: vi.fn<(options: PagesServerOptions) => Promise<number>>(),
  initializePagesRuntime: vi.fn(),
  installProcessLogging: vi.fn(),
  shutdownProcess: vi.fn(),
}));

vi.mock("virtual:react-router/server-build", () => ({
  routes: "server-build-routes",
}));
vi.mock("@/backend/config/StartOptions", () => ({
  parseStartOptions: mocks.parseStartOptions,
}));
vi.mock("@/backend/config/PagesConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof PagesConfigModule>()),
  resolveDefaultConfigPath: mocks.resolveDefaultConfigPath,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logDiagnostic: mocks.logDiagnostic,
  initializeLogging: mocks.initializeLogging,
  closeLogging: mocks.closeLogging,
  logEvent: mocks.logEvent,
}));
vi.mock("./PagesServer", () => ({ startPagesServer: mocks.startPagesServer }));
vi.mock("./PagesRuntime", () => ({
  initializePagesRuntime: mocks.initializePagesRuntime,
}));
vi.mock("./ProcessLifecycle", () => ({
  installProcessLogging: mocks.installProcessLogging,
  shutdownProcess: mocks.shutdownProcess,
}));
vi.mock("./RunsEntry", () => ({ startRuns: vi.fn() }));
vi.mock("./IntegrationsEntry", () => ({ startIntegrations: vi.fn() }));
vi.mock("./IngressEntry", () => ({ startIngress: vi.fn() }));

const DEFAULT_PATH = "/home/user/.pages/config.toml";

beforeEach(() => {
  mocks.parseStartOptions.mockReturnValue({ configPath: null, port: null });
  mocks.resolveDefaultConfigPath.mockReturnValue(DEFAULT_PATH);
  mocks.initializeLogging.mockResolvedValue(undefined);
  mocks.closeLogging.mockResolvedValue(undefined);
  mocks.initializePagesRuntime.mockResolvedValue(undefined);
  mocks.shutdownProcess.mockResolvedValue(undefined);
});

describe("startServer", () => {
  it("starts logging, runtime and server with the default configuration path", async () => {
    mocks.startPagesServer.mockResolvedValue(0);

    await expect(startServer(["--flag"])).resolves.toBe(0);

    expect(mocks.installProcessLogging).toHaveBeenCalledTimes(1);
    expect(mocks.parseStartOptions).toHaveBeenCalledWith(["--flag"]);
    expect(mocks.initializeLogging).toHaveBeenCalledWith(DEFAULT_PATH);
    expect(mocks.initializePagesRuntime).toHaveBeenCalledWith(DEFAULT_PATH);
    expect(mocks.startPagesServer).toHaveBeenCalledTimes(1);
    const [options] = mocks.startPagesServer.mock.calls[0] ?? [];
    expect(options?.argumentList).toEqual(["--flag"]);
    expect(options?.build.routes).toEqual("server-build-routes");
    expect(options?.clientDirectory).toMatch(/\/backend\/client$/u);
    expect(mocks.closeLogging).not.toHaveBeenCalled();
  });

  it("uses the configuration path given on the command line", async () => {
    mocks.parseStartOptions.mockReturnValue({
      configPath: "/custom/config.toml",
      port: null,
    });
    mocks.startPagesServer.mockResolvedValue(0);

    await startServer([]);

    expect(mocks.initializeLogging).toHaveBeenCalledWith("/custom/config.toml");
    expect(mocks.initializePagesRuntime).toHaveBeenCalledWith(
      "/custom/config.toml",
    );
  });

  it("closes logging and returns the code when the server ends the start", async () => {
    mocks.startPagesServer.mockResolvedValue(1);

    await expect(startServer([])).resolves.toBe(1);

    expect(mocks.closeLogging).toHaveBeenCalledTimes(1);
    expect(mocks.shutdownProcess).not.toHaveBeenCalled();
  });

  it("logs a fatal event and shuts the process down when the start throws", async () => {
    const failure = new Error("boom");
    mocks.initializePagesRuntime.mockRejectedValue(failure);

    await expect(startServer([])).resolves.toBe(1);

    expect(mocks.logDiagnostic).not.toHaveBeenCalled();
    expect(mocks.logCaughtError).toHaveBeenCalledWith("ServerEntry", failure);
    expect(mocks.logEvent).toHaveBeenCalledWith({
      level: "fatal",
      event: "server.start.failed",
      component: "ServerEntry",
      message: "Server could not start",
      error: failure,
    });
    expect(mocks.shutdownProcess).toHaveBeenCalledWith(1, "startup", failure);
  });

  it("explains a missing databaseUrl to the operator", async () => {
    const failure = new MissingDatabaseUrlError("/data/config.toml");
    mocks.parseStartOptions.mockImplementation(() => {
      throw failure;
    });

    await expect(startServer([])).resolves.toBe(1);

    expect(mocks.logDiagnostic).toHaveBeenCalledWith(
      "ServerEntry",
      "error",
      "[pages] A PostgreSQL databaseUrl is required for a completed setup.",
    );
    expect(mocks.shutdownProcess).toHaveBeenCalledWith(1, "startup", failure);
  });
});
