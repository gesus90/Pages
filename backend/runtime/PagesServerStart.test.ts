import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkHealth } from "@/app/lib/health.server";
import { ConfigFile } from "@/backend/config/ConfigFile";
import { ConfigError, DEFAULT_CONFIG } from "@/backend/config/PagesConfig";
import { StartOptionsError, START_USAGE } from "@/backend/config/StartOptions";

import { PagesRuntime } from "./PagesRuntime";
import { startPagesServer } from "./PagesServer";

import type * as HttpModule from "node:http";
import type * as OsModule from "node:os";
import type * as ReactRouterModule from "react-router";
import type * as PagesRuntimeModule from "./PagesRuntime";
import type * as PagesConfigModule from "@/backend/config/PagesConfig";
import type * as StartOptionsModule from "@/backend/config/StartOptions";
import type { HealthStatus } from "@/app/lib/health.server";
import type { CompletedSetupConfig } from "@/backend/config/PagesConfig";
import type { ServerBuild } from "react-router";

interface ShutdownOptions {
  readonly step: string;
}

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  parseStartOptions: vi.fn(),
  resolveDefaultConfigPath: vi.fn(),
  initializePagesRuntime: vi.fn(),
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  logEvent: vi.fn(),
  installProcessLogging: vi.fn(),
  registerShutdownTask:
    vi.fn<(task: () => Promise<void>, options: ShutdownOptions) => void>(),
  installRunnerChannel: vi.fn(),
  installRemoteConsoleChannel: vi.fn(),
  installConversationWebChannel: vi.fn(),
  installAgentCallChannel: vi.fn(),
  startAgentTools: vi.fn(),
  startPicaMobile: vi.fn(),
  startServiceWatchdog: vi.fn<(probe: () => Promise<boolean>) => void>(),
  networkInterfaces: vi.fn(() => ({})),
}));

vi.mock("node:http", async (importOriginal) => ({
  ...(await importOriginal<typeof HttpModule>()),
  createServer: mocks.createServer,
}));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof OsModule>()),
  networkInterfaces: mocks.networkInterfaces,
}));
vi.mock("@remix-run/node-fetch-server", () => ({
  createRequestListener: vi.fn(),
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouterModule>()),
  createRequestHandler: vi.fn(),
}));
vi.mock("@/app/lib/health.server", () => ({ checkHealth: vi.fn() }));
vi.mock("@/backend/config/PagesConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof PagesConfigModule>()),
  resolveDefaultConfigPath: mocks.resolveDefaultConfigPath,
}));
vi.mock("@/backend/config/StartOptions", async (importOriginal) => ({
  ...(await importOriginal<typeof StartOptionsModule>()),
  parseStartOptions: mocks.parseStartOptions,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logDiagnostic: mocks.logDiagnostic,
  logEvent: mocks.logEvent,
}));
vi.mock("./PagesRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof PagesRuntimeModule>()),
  initializePagesRuntime: mocks.initializePagesRuntime,
}));
vi.mock("./AgentToolsStartup", () => ({
  startAgentTools: mocks.startAgentTools,
}));
vi.mock("./RunnerChannel", () => ({
  installRunnerChannel: mocks.installRunnerChannel,
}));
vi.mock("./RemoteConsoleChannel", () => ({
  installRemoteConsoleChannel: mocks.installRemoteConsoleChannel,
}));
vi.mock("./ConversationWebChannel", () => ({
  installConversationWebChannel: mocks.installConversationWebChannel,
}));
vi.mock("./AgentCallChannel", () => ({
  installAgentCallChannel: mocks.installAgentCallChannel,
}));
vi.mock("./AgentCallChannel", () => ({
  installAgentCallChannel: mocks.installAgentCallChannel,
}));
vi.mock("./PicaMobileRuntime", () => ({
  startPicaMobile: mocks.startPicaMobile,
}));
vi.mock("./AppRoutes", () => ({ AppRoutes: vi.fn() }));
vi.mock("./LoggedRoutes", () => ({
  withLoggedRoutes: (build: ServerBuild) => build,
}));
vi.mock("./ServiceWatchdog", () => ({
  startServiceWatchdog: mocks.startServiceWatchdog,
}));
vi.mock("./ProcessLifecycle", () => ({
  installProcessLogging: mocks.installProcessLogging,
  registerShutdownTask: mocks.registerShutdownTask,
}));

const DEFAULT_PATH = "/home/user/.pages/config.toml";

class FakeServer extends EventEmitter {
  public listening = false;
  public readonly listen = vi.fn();
  public readonly close = vi.fn();
  public readonly closeIdleConnections = vi.fn();
}

function createBuild(): ServerBuild {
  const opaqueBuild: unknown = { routes: {} };

  return opaqueBuild as ServerBuild;
}

function createRuntime(
  overrides: Partial<CompletedSetupConfig> = {},
): PagesRuntime {
  const config: CompletedSetupConfig = {
    ...DEFAULT_CONFIG,
    firstRun: false,
    databasePath: "/data/db",
    port: 3000,
    ...overrides,
  };

  return new PagesRuntime(new ConfigFile(DEFAULT_PATH), config);
}

function prepare(
  runtime: PagesRuntime,
  port: number | null = null,
): FakeServer {
  const server = new FakeServer();
  server.listen.mockImplementation(
    (
      listenPort: number,
      address: string | undefined,
      onListening: () => void,
    ) => {
      server.listening = true;
      onListening();
    },
  );
  mocks.createServer.mockReturnValue(server);
  mocks.parseStartOptions.mockReturnValue({ configPath: null, port });
  mocks.initializePagesRuntime.mockResolvedValue(runtime);

  return server;
}

function start(argumentList: readonly string[] = []): Promise<number> {
  return startPagesServer({
    argumentList,
    build: createBuild(),
    clientDirectory: "/srv/client",
  });
}

function announcedText(): string {
  const call = mocks.logDiagnostic.mock.calls.find(
    (entry) => entry[1] === "info",
  );

  return String(call?.[2]);
}

beforeEach(() => {
  mocks.resolveDefaultConfigPath.mockReturnValue(DEFAULT_PATH);
  mocks.networkInterfaces.mockReturnValue({});
  mocks.startAgentTools.mockResolvedValue(undefined);
  mocks.startPicaMobile.mockResolvedValue(undefined);
});

describe("startPagesServer on success", () => {
  it("wires the channels, listens on the configured port and reports success", async () => {
    const runtime = createRuntime({ trustedProxies: ["10.0.0.1"] });
    const server = prepare(runtime);

    await expect(start()).resolves.toBe(0);

    expect(mocks.installProcessLogging).toHaveBeenCalledTimes(1);
    expect(mocks.initializePagesRuntime).toHaveBeenCalledWith(DEFAULT_PATH);
    expect(mocks.createServer).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.installRunnerChannel).toHaveBeenCalledWith(server);
    expect(mocks.installRemoteConsoleChannel).toHaveBeenCalledWith(server, [
      "10.0.0.1",
    ]);
    expect(mocks.installConversationWebChannel).toHaveBeenCalledWith(server, {
      trustedProxies: ["10.0.0.1"],
    });
    expect(mocks.installAgentCallChannel).toHaveBeenCalledWith(server, [
      "10.0.0.1",
    ]);
    expect(server.listen).toHaveBeenCalledWith(
      3000,
      undefined,
      expect.any(Function),
    );
    expect(mocks.startAgentTools).toHaveBeenCalledWith(runtime);
    expect(mocks.startPicaMobile).toHaveBeenCalledWith(runtime, 3000);
    expect(announcedText()).toBe(
      "[pages] Pages is running at http://localhost:3000.",
    );
    expect(mocks.logEvent).toHaveBeenCalledWith({
      level: "info",
      event: "server.forwarding.configured",
      component: "PagesServer",
      message:
        "X-Forwarded-Proto is believed from 1 proxy entries of trustedProxies",
      metadata: { count: 1 },
    });
  });

  it("uses the configuration path of the start parameters and says no proxy is trusted", async () => {
    const runtime = createRuntime();
    prepare(runtime);
    mocks.parseStartOptions.mockReturnValue({
      configPath: "/custom/config.toml",
      port: null,
    });

    await start(["--config", "/custom/config.toml"]);

    expect(mocks.initializePagesRuntime).toHaveBeenCalledWith(
      "/custom/config.toml",
    );
    expect(mocks.installConversationWebChannel).toHaveBeenCalledWith(
      expect.anything(),
      { trustedProxies: [] },
    );
    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "No proxy is listed in trustedProxies; X-Forwarded-Proto is ignored and requests keep the protocol of their connection",
        metadata: { count: 0 },
      }),
    );
  });

  it("closes the server and idle connections at shutdown", async () => {
    const server = prepare(createRuntime());
    await start();

    const [task, options] = mocks.registerShutdownTask.mock.calls[0] ?? [];
    await task?.();

    expect(options).toEqual({ step: "http_server" });
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);
  });
});

describe("startPagesServer addresses", () => {
  it.each([
    ["a concrete IPv4 address", "127.0.0.1", "http://127.0.0.1:3000"],
    ["a concrete IPv6 address", "::1", "http://[::1]:3000"],
    ["the IPv4 wildcard", "0.0.0.0", "http://localhost:3000"],
    ["the IPv6 wildcard", "::", "http://localhost:3000"],
  ])("announces %s", async (description, listenAddress, origin) => {
    const server = prepare(createRuntime({ listenAddress }));

    await start();

    expect(server.listen).toHaveBeenCalledWith(
      3000,
      listenAddress,
      expect.any(Function),
    );
    expect(announcedText()).toContain(`running at ${origin}.`);
  });

  it("lists external addresses when no listen address is configured", async () => {
    prepare(createRuntime());
    mocks.networkInterfaces.mockReturnValue({
      eth0: [
        {
          address: "192.168.0.7",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:00:00:00:00",
          internal: false,
          cidr: "192.168.0.7/24",
        },
      ],
    });

    await start();

    expect(announcedText()).toBe(
      "[pages] Pages is running at http://localhost:3000 and http://192.168.0.7:3000.",
    );
  });
});

describe("startPagesServer with a --port parameter", () => {
  it("listens on the given port and stores it in the configuration", async () => {
    const runtime = createRuntime();
    const server = prepare(runtime, 4100);
    const update = vi
      .spyOn(runtime.configFile, "update")
      .mockResolvedValue(runtime.getConfig());

    await start();

    expect(server.listen).toHaveBeenCalledWith(
      4100,
      undefined,
      expect.any(Function),
    );
    const [change] = update.mock.calls[0] ?? [];
    expect(change?.(runtime.getConfig()).port).toBe(4100);
  });

  it("does not rewrite the configuration when the port is unchanged", async () => {
    const runtime = createRuntime();
    prepare(runtime, 3000);
    const update = vi.spyOn(runtime.configFile, "update");

    await start();

    expect(update).not.toHaveBeenCalled();
  });

  it("keeps running and warns when the port cannot be stored", async () => {
    const runtime = createRuntime();
    prepare(runtime, 4100);
    const failure = new Error("read-only");
    vi.spyOn(runtime.configFile, "update").mockRejectedValue(failure);

    await expect(start()).resolves.toBe(0);

    expect(mocks.logCaughtError).toHaveBeenCalledWith("PagesServer", failure);
    expect(mocks.logDiagnostic).toHaveBeenCalledWith(
      "PagesServer",
      "warn",
      "[pages] The port 4100 could not be stored.",
      failure,
    );
  });
});

describe("startPagesServer watchdog", () => {
  async function probe(
    isListening: boolean,
    status: HealthStatus,
  ): Promise<boolean> {
    const server = prepare(createRuntime());
    vi.mocked(checkHealth).mockResolvedValue({
      status,
      database: "not_started",
    });
    await start();
    server.listening = isListening;
    const [probeHealth] = mocks.startServiceWatchdog.mock.calls[0] ?? [];

    return (await probeHealth?.()) ?? false;
  }

  it("is healthy while listening and the health check is ok", async () => {
    await expect(probe(true, "ok")).resolves.toBe(true);
  });

  it("is unhealthy when the health check reports a problem", async () => {
    await expect(probe(true, "unavailable")).resolves.toBe(false);
  });

  it("is unhealthy without a listening server and skips the health check", async () => {
    await expect(probe(false, "ok")).resolves.toBe(false);
    expect(checkHealth).not.toHaveBeenCalled();
  });
});

describe("startPagesServer failures", () => {
  it("prints the usage and fails for invalid start parameters", async () => {
    const failure = new StartOptionsError("bad flag");
    mocks.parseStartOptions.mockImplementation(() => {
      throw failure;
    });

    await expect(start(["--bad"])).resolves.toBe(1);

    expect(mocks.logCaughtError).toHaveBeenCalledWith("PagesServer", failure);
    expect(mocks.logDiagnostic).toHaveBeenCalledWith(
      "PagesServer",
      "error",
      `[pages] Unknown start parameter or invalid value.\n\n${START_USAGE}`,
      failure,
    );
    expect(mocks.createServer).not.toHaveBeenCalled();
  });

  it("reports an unusable configuration and fails", async () => {
    const failure = new ConfigError("invalid port");
    mocks.parseStartOptions.mockReturnValue({ configPath: null, port: null });
    mocks.initializePagesRuntime.mockRejectedValue(failure);

    await expect(start()).resolves.toBe(1);

    expect(mocks.logDiagnostic).toHaveBeenCalledWith(
      "PagesServer",
      "error",
      "[pages] invalid port",
      failure,
    );
  });

  it("rethrows an unexpected error while loading the runtime", async () => {
    const failure = new Error("disk gone");
    mocks.parseStartOptions.mockReturnValue({ configPath: null, port: null });
    mocks.initializePagesRuntime.mockRejectedValue(failure);

    await expect(start()).rejects.toBe(failure);
    expect(mocks.logDiagnostic).not.toHaveBeenCalled();
  });

  it.each([
    [
      "EADDRINUSE",
      '[pages] Port 3000 is already in use. Stop the other program, start Pages with --port <number>, or change "port" in the configuration.',
    ],
    [
      "EACCES",
      '[pages] Port 3000 cannot be used without more privileges. Start Pages with --port <number> above 1023, or change "port" in the configuration.',
    ],
  ])(
    "explains %s and fails without storing the port",
    async (code, message) => {
      const runtime = createRuntime();
      const server = prepare(runtime, 3000);
      server.listen.mockImplementation(() => {
        server.emit("error", Object.assign(new Error(code), { code }));
      });
      const update = vi.spyOn(runtime.configFile, "update");

      await expect(start()).resolves.toBe(1);

      expect(mocks.logDiagnostic).toHaveBeenCalledWith(
        "PagesServer",
        "error",
        message,
      );
      expect(update).not.toHaveBeenCalled();
      expect(mocks.startAgentTools).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "an error with another code",
      Object.assign(new Error("x"), { code: "EMFILE" }),
    ],
    ["an error without a code", new Error("plain")],
    ["a non-object error", "text failure"],
    ["a null error", null],
  ])("rethrows %s from listening", async (description, failure) => {
    const server = prepare(createRuntime());
    server.listen.mockImplementation(() => {
      server.emit("error", failure);
    });

    await expect(start()).rejects.toBe(failure);
    expect(mocks.logCaughtError).toHaveBeenCalledWith("PagesServer", failure);
  });
});
