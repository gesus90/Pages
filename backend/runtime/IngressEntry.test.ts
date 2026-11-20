import { EventEmitter } from "node:events";

import { beforeEach, expect, it, vi } from "vitest";

import { logEvent, updateLogRetention } from "@/backend/logging/Logger";
import { DEFAULT_LOG_RETENTION_DAYS } from "@/definition/Logging";

import { createIngressServer } from "./Ingress";
import { startIngress } from "./IngressEntry";
import { registerShutdownTask, shutdownProcess } from "./ProcessLifecycle";

import type { Mock } from "vitest";

interface FakeServer extends EventEmitter {
  listen: Mock;
  close: Mock;
  closeIdleConnections: Mock;
}

interface IngressHolder {
  server: FakeServer | undefined;
}

const ingress = vi.hoisted((): IngressHolder => ({ server: undefined }));

const config = vi.hoisted(() => ({
  read: vi.fn(),
  paths: [] as string[],
}));

vi.mock("@/backend/config/ConfigFile", () => ({
  ConfigFile: class ConfigFile {
    public readonly read = config.read;

    public constructor(path: string) {
      config.paths.push(path);
    }
  },
}));
vi.mock("@/backend/logging/Logger", () => ({
  initializeLogging: vi.fn().mockResolvedValue(undefined),
  logEvent: vi.fn(),
  updateLogRetention: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./Ingress", () => ({
  createIngressServer: vi.fn(() => ingress.server),
}));
vi.mock("./ProcessLifecycle", () => ({
  installProcessLogging: vi.fn(),
  registerShutdownTask: vi.fn(),
  shutdownProcess: vi.fn().mockResolvedValue(undefined),
}));

const REQUIRED = [
  "--config",
  "/etc/pages/config.toml",
  "--listen",
  "0.0.0.0:8080",
  "--backend",
  "http://127.0.0.1:3100",
];

let server: FakeServer;

function listenImmediately(): void {
  server.listen.mockImplementation(
    (...parameters: [number, string, () => void]) => {
      parameters[2]();
    },
  );
}

async function failedStart(argumentList: readonly string[]): Promise<unknown> {
  await startIngress(argumentList);

  expect(createIngressServer).not.toHaveBeenCalled();
  const call = vi.mocked(shutdownProcess).mock.calls[0];
  expect(call?.[0]).toBe(1);
  expect(call?.[1]).toBe("ingress_startup");
  return call?.[2];
}

beforeEach(() => {
  config.paths = [];
  config.read.mockResolvedValue(null);
  server = Object.assign(new EventEmitter(), {
    listen: vi.fn(),
    close: vi.fn(),
    closeIdleConnections: vi.fn(),
  });
  listenImmediately();
  ingress.server = server;
});

it("starts the entrance on the configured address with default retention", async () => {
  await startIngress(REQUIRED);

  expect(shutdownProcess).not.toHaveBeenCalled();
  expect(config.paths).toEqual(["/etc/pages/config.toml"]);
  expect(updateLogRetention).toHaveBeenCalledWith(
    DEFAULT_LOG_RETENTION_DAYS,
    "startup",
  );
  const options = vi.mocked(createIngressServer).mock.calls[0]?.[0];
  expect(options).toEqual({
    backend: new URL("http://127.0.0.1:3100"),
    trustedProxies: [],
    core: undefined,
    serviceStatus: undefined,
    coreRunner: undefined,
    coreConsole: undefined,
    clientDirectory: options?.clientDirectory,
  });
  expect(options?.clientDirectory).toMatch(/\/backend\/client$/u);
  expect(server.listen).toHaveBeenCalledWith(
    8080,
    "0.0.0.0",
    expect.any(Function),
  );
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "ingress.started",
      message: "Static app entrance listens on 0.0.0.0:8080",
      metadata: {
        backend: "http://127.0.0.1:3100",
        source: "api",
        origin: null,
        status: null,
        runner: null,
        console: null,
      },
    }),
  );
});

it("uses the configured retention and trusted proxies and announces them", async () => {
  config.read.mockResolvedValue({
    logRetentionDays: 7,
    trustedProxies: ["10.0.0.1", "10.0.0.2"],
  });

  await startIngress(REQUIRED);

  expect(updateLogRetention).toHaveBeenCalledWith(7, "startup");
  expect(createIngressServer).toHaveBeenCalledWith(
    expect.objectContaining({ trustedProxies: ["10.0.0.1", "10.0.0.2"] }),
  );
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "ingress.forwarding.configured",
      metadata: { count: 2 },
    }),
  );
});

it("passes every switch to the core as an origin and reports them", async () => {
  await startIngress([
    ...REQUIRED,
    "--core",
    "http://127.0.0.1:3200",
    "--service-status",
    "http://127.0.0.1:3201",
    "--core-runner",
    "http://127.0.0.1:3202",
    "--core-console",
    "http://127.0.0.1:3203",
  ]);

  expect(createIngressServer).toHaveBeenCalledWith(
    expect.objectContaining({
      core: new URL("http://127.0.0.1:3200"),
      serviceStatus: new URL("http://127.0.0.1:3201"),
      coreRunner: new URL("http://127.0.0.1:3202"),
      coreConsole: new URL("http://127.0.0.1:3203"),
    }),
  );
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "ingress.started",
      metadata: {
        backend: "http://127.0.0.1:3100",
        source: "core",
        origin: "http://127.0.0.1:3200",
        status: "http://127.0.0.1:3201",
        runner: "http://127.0.0.1:3202",
        console: "http://127.0.0.1:3203",
      },
    }),
  );
});

it("accepts a bracketed IPv6 listen address", async () => {
  await startIngress([
    "--config",
    "/etc/pages/config.toml",
    "--listen",
    "[::1]:65535",
    "--backend",
    "http://127.0.0.1:3100",
  ]);

  expect(server.listen).toHaveBeenCalledWith(65_535, "::1", expect.anything());
});

it("closes the server and its idle connections at shutdown", async () => {
  await startIngress(REQUIRED);
  const call = vi.mocked(registerShutdownTask).mock.calls[0];

  await call?.[0]();

  expect(call?.[1]).toEqual({ step: "http_server" });
  expect(server.close).toHaveBeenCalledOnce();
  expect(server.closeIdleConnections).toHaveBeenCalledOnce();
});

it("ends the process when the port cannot be bound", async () => {
  const failure = new Error("EADDRINUSE");
  server.listen.mockImplementation(() => {
    server.emit("error", failure);
  });

  await startIngress(REQUIRED);

  expect(shutdownProcess).toHaveBeenCalledWith(1, "ingress_startup", failure);
  expect(logEvent).not.toHaveBeenCalledWith(
    expect.objectContaining({ event: "ingress.started" }),
  );
});

it("removes the startup error handler once the server listens", async () => {
  await startIngress(REQUIRED);

  expect(server.listenerCount("error")).toBe(0);
});

it.each([
  { name: "a missing value", args: [...REQUIRED, "--core"] },
  { name: "an empty option name", args: ["", "x", ...REQUIRED] },
  {
    name: "a repeated option",
    args: [...REQUIRED, "--listen", "127.0.0.1:1"],
  },
  { name: "an unknown option", args: [...REQUIRED, "--verbose", "yes"] },
  { name: "a missing configuration", args: REQUIRED.slice(2) },
  {
    name: "a missing listen address",
    args: [...REQUIRED.slice(0, 2), ...REQUIRED.slice(4)],
  },
  { name: "a missing backend", args: REQUIRED.slice(0, 4) },
  {
    name: "a relative configuration path",
    args: ["--config", "config.toml", ...REQUIRED.slice(2)],
  },
  {
    name: "an empty configuration path",
    args: ["--config", "", ...REQUIRED.slice(2)],
  },
])("refuses to start with $name and shows the usage", async ({ args }) => {
  const error = await failedStart(args);

  expect(error).toBeInstanceOf(Error);
  expect(error).toHaveProperty(
    "message",
    expect.stringMatching(/^Usage: node pages-ingress\.mjs/u),
  );
});

it.each([
  { name: "a host name instead of an address", listen: "localhost:8080" },
  { name: "no port separator", listen: "127.0.0.1" },
  { name: "port zero", listen: "127.0.0.1:0" },
  { name: "a port above the range", listen: "127.0.0.1:65536" },
  { name: "a fractional port", listen: "127.0.0.1:80.5" },
  { name: "a non-numeric port", listen: "127.0.0.1:http" },
])("refuses a listen address with $name", async ({ listen }) => {
  const error = await failedStart([
    ...REQUIRED.slice(0, 2),
    "--listen",
    listen,
    ...REQUIRED.slice(4),
  ]);

  expect(error).toHaveProperty("message", expect.stringMatching(/^Usage:/u));
});

it.each([
  { name: "an https origin", backend: "https://127.0.0.1:3100" },
  { name: "an origin without a port", backend: "http://127.0.0.1" },
])("refuses a backend with $name", async ({ backend }) => {
  const error = await failedStart([
    ...REQUIRED.slice(0, 4),
    "--backend",
    backend,
  ]);

  expect(error).toHaveProperty("message", expect.stringMatching(/^Usage:/u));
});

it("refuses a switch origin that is not http with a port", async () => {
  const error = await failedStart([...REQUIRED, "--core", "http://127.0.0.1"]);

  expect(error).toHaveProperty("message", expect.stringMatching(/^Usage:/u));
});

it("ends the process with the parse error for a backend that is no URL", async () => {
  const error = await failedStart([
    ...REQUIRED.slice(0, 4),
    "--backend",
    "not a url",
  ]);

  expect(error).toBeInstanceOf(TypeError);
});

it("ends the process when the configuration cannot be read", async () => {
  const failure = new Error("invalid config");
  config.read.mockRejectedValue(failure);

  await startIngress(REQUIRED);

  expect(shutdownProcess).toHaveBeenCalledWith(1, "ingress_startup", failure);
  expect(createIngressServer).not.toHaveBeenCalled();
});
