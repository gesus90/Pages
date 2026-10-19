import { createServer } from "node:http";
import { networkInterfaces } from "node:os";

import { createRequestListener } from "@remix-run/node-fetch-server";
import { RouterContextProvider, createRequestHandler } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clientSocketAddressContext } from "@/app/lib/client-address.server";
import { ConfigFile } from "@/backend/config/ConfigFile";
import { ConfigError } from "@/backend/config/PagesConfig";
import {
  initializePagesRuntime,
  PagesRuntime,
} from "@/backend/runtime/PagesRuntime";
import {
  announceServer,
  createPagesRequestListener,
  listServerOrigins,
  startPagesServer,
} from "@/backend/runtime/PagesServer";
import { serveStaticAsset } from "@/backend/runtime/StaticAssets";

import {
  createFakeServer,
  createRuntime,
  listenError,
  SERVER_BUILD,
} from "./pages-server-fixture";
import { createStaticExchange } from "./static-asset-exchange";

import type {
  NetworkInterfaceInfoIPv4,
  NetworkInterfaceInfoIPv6,
} from "node:os";
import type { PagesConfig } from "@/backend/config/PagesConfig";
import type { RequestHandler } from "react-router";

vi.mock("@/backend/runtime/AgentToolsStartup", () => ({
  startAgentTools: vi.fn(async () => undefined),
}));

vi.mock("node:os", () => ({
  homedir: () => "/home/pages",
  networkInterfaces: vi.fn(),
}));
vi.mock("node:http", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createServer: vi.fn(),
}));
vi.mock("@remix-run/node-fetch-server", () => ({
  createRequestListener: vi.fn(),
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createRequestHandler: vi.fn(),
}));
vi.mock("@/backend/runtime/StaticAssets", () => ({
  serveStaticAsset: vi.fn(),
}));
vi.mock("@/backend/runtime/PagesRuntime", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  initializePagesRuntime: vi.fn(),
}));

const PENDING: PagesConfig = { databasePath: null, firstRun: true, port: 3000 };
const COMPLETED: PagesConfig = {
  databasePath: "/srv/pages/data/pages.duckdb",
  firstRun: false,
  port: 4100,
};

function ipv4(address: string, isInternal = false): NetworkInterfaceInfoIPv4 {
  return {
    address,
    cidr: null,
    family: "IPv4",
    internal: isInternal,
    mac: "00:00:00:00:00:00",
    netmask: "255.255.255.0",
  };
}

function ipv6(address: string): NetworkInterfaceInfoIPv6 {
  return {
    address,
    cidr: null,
    family: "IPv6",
    internal: false,
    mac: "00:00:00:00:00:00",
    netmask: "ffff:ffff:ffff:ffff::",
    scopeid: 1,
  };
}

beforeEach(() => {
  vi.mocked(networkInterfaces).mockReturnValue({});
});

afterEach(() => {
  vi.mocked(createServer).mockReset();
  vi.mocked(createRequestListener).mockReset();
  vi.mocked(createRequestHandler).mockReset();
  vi.mocked(serveStaticAsset).mockReset();
  vi.mocked(initializePagesRuntime).mockReset();
});

describe("listServerOrigins", () => {
  it("lists localhost first and every external IPv4 address", () => {
    vi.mocked(networkInterfaces).mockReturnValue({
      docker0: [ipv4("172.17.0.1")],
      eth0: [ipv4("192.168.1.20"), ipv6("fe80::1")],
      lo: [ipv4("127.0.0.1", true)],
    });

    expect(listServerOrigins(3000)).toEqual([
      "http://localhost:3000",
      "http://172.17.0.1:3000",
      "http://192.168.1.20:3000",
    ]);
  });

  it("lists only localhost when no interface is external", () => {
    vi.mocked(networkInterfaces).mockReturnValue({ down: undefined });

    expect(listServerOrigins(8080)).toEqual(["http://localhost:8080"]);
  });
});

describe("announceServer", () => {
  it("prints the addresses and no link after the setup", () => {
    const info = vi.spyOn(console, "info").mockReturnValue(undefined);
    const runtime = new PagesRuntime(new ConfigFile("/srv/c.toml"), COMPLETED);

    announceServer(runtime, ["http://localhost:4100", "http://10.0.0.5:4100"]);

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      "[pages] Pages is running at http://localhost:4100 and http://10.0.0.5:4100.",
    );
  });

  it("prints pending setup links directly to operator stdout", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const runtime = new PagesRuntime(new ConfigFile("/srv/c.toml"), PENDING);
    const token = runtime.getSetupToken() ?? "";

    announceServer(runtime, ["http://localhost:3000", "http://10.0.0.5:3000"]);

    const lines = stdout.mock.calls.map((call) => String(call[0]));
    expect(lines).toContain(
      "[pages] Pages is not set up yet. Open the setup wizard with this one-time link:\n",
    );
    expect(lines).toContain(
      `[pages]   http://localhost:3000/setup?token=${token}\n`,
    );
    expect(lines).toContain(
      `[pages]   http://10.0.0.5:3000/setup?token=${token}\n`,
    );
  });
});

describe("the request listener", () => {
  it("serves a build file without calling the application", async () => {
    const application = vi.fn();
    vi.mocked(createRequestListener).mockReturnValue(application);
    vi.mocked(serveStaticAsset).mockResolvedValue(true);
    const listener = createPagesRequestListener(SERVER_BUILD, "/srv/client");
    const exchange = createStaticExchange("GET", "/assets/app.js");

    listener(exchange.request, exchange.response);

    await vi.waitFor(() => {
      expect(serveStaticAsset).toHaveBeenCalledWith(
        exchange.request,
        exchange.response,
        "/srv/client",
      );
    });
    await Promise.resolve();
    expect(application).not.toHaveBeenCalled();
  });

  it("hands every other request to the application", async () => {
    const application = vi.fn();
    vi.mocked(createRequestListener).mockReturnValue(application);
    vi.mocked(serveStaticAsset).mockResolvedValue(false);
    const listener = createPagesRequestListener(SERVER_BUILD, "/srv/client");
    const exchange = createStaticExchange("GET", "/projects");

    listener(exchange.request, exchange.response);

    await vi.waitFor(() => {
      expect(application).toHaveBeenCalledWith(
        exchange.request,
        exchange.response,
      );
    });
  });

  it("runs the application in production mode with the socket address", async () => {
    const handleRequest = vi
      .fn<RequestHandler>()
      .mockResolvedValue(new Response("unused"));
    vi.mocked(createRequestHandler).mockReturnValue(handleRequest);
    vi.mocked(createRequestListener).mockReturnValue(vi.fn());

    createPagesRequestListener(SERVER_BUILD, "/srv/client");

    expect(createRequestHandler).toHaveBeenCalledWith(
      SERVER_BUILD,
      "production",
    );
    const handleFetch = vi.mocked(createRequestListener).mock.calls[0]?.[0];
    await handleFetch?.(new Request("http://pages.invalid/"), {
      address: "203.0.113.9",
      family: "IPv4",
      port: 51_000,
    });
    const context = handleRequest.mock.calls[0]?.[1];
    expect(
      context instanceof RouterContextProvider
        ? context.get(clientSocketAddressContext)
        : null,
    ).toBe("203.0.113.9");
  });

  it("builds https URLs only on the second listener", () => {
    vi.mocked(createRequestListener).mockReturnValue(vi.fn());

    createPagesRequestListener(SERVER_BUILD, "/srv/client");

    expect(
      vi.mocked(createRequestListener).mock.calls.map((call) => call[1]),
    ).toEqual([undefined, { protocol: "https:" }]);
  });

  it("uses the https listener only for a trusted proxy that forwards HTTPS", async () => {
    const direct = vi.fn();
    const forwardedHttps = vi.fn();
    vi.mocked(createRequestListener)
      .mockReturnValueOnce(direct)
      .mockReturnValueOnce(forwardedHttps);
    vi.mocked(serveStaticAsset).mockResolvedValue(false);
    const listener = createPagesRequestListener(SERVER_BUILD, "/srv/client", [
      "192.0.2.10",
    ]);

    for (const [peer, protocol] of [
      ["192.0.2.10", "https"],
      ["192.0.2.10", "http"],
      ["198.51.100.7", "https"],
    ] as const) {
      const exchange = createStaticExchange("POST", "/login");
      Object.defineProperty(exchange.request.socket, "remoteAddress", {
        value: peer,
      });
      exchange.request.headers = { "x-forwarded-proto": protocol };
      listener(exchange.request, exchange.response);
    }

    await vi.waitFor(() => {
      expect(direct).toHaveBeenCalledTimes(2);
    });
    expect(forwardedHttps).toHaveBeenCalledTimes(1);
  });
});

describe("startPagesServer: start parameters", () => {
  it("answers 1 with the usage for an unknown parameter", async () => {
    const error = vi.spyOn(console, "error").mockReturnValue(undefined);

    const code = await startPagesServer({
      argumentList: ["--bogus"],
      build: SERVER_BUILD,
      clientDirectory: "/srv/client",
    });

    expect(code).toBe(1);
    expect(String(error.mock.calls[0]?.[0])).toContain(
      "Unknown start parameter",
    );
    expect(String(error.mock.calls[0]?.[0])).toContain("Usage: pnpm start");
    expect(createServer).not.toHaveBeenCalled();
    expect(initializePagesRuntime).not.toHaveBeenCalled();
  });

  it("answers 1 for a port outside the valid range", async () => {
    vi.spyOn(console, "error").mockReturnValue(undefined);

    const code = await startPagesServer({
      argumentList: ["--port", "70000"],
      build: SERVER_BUILD,
      clientDirectory: "/srv/client",
    });

    expect(code).toBe(1);
    expect(createServer).not.toHaveBeenCalled();
  });

  it("answers 1 with the message of an unusable configuration", async () => {
    const error = vi.spyOn(console, "error").mockReturnValue(undefined);
    vi.mocked(initializePagesRuntime).mockRejectedValue(
      new ConfigError("The configuration file is not valid TOML."),
    );

    const code = await startPagesServer({
      argumentList: [],
      build: SERVER_BUILD,
      clientDirectory: "/srv/client",
    });

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(
      "[pages] The configuration file is not valid TOML.",
      expect.objectContaining({
        type: "ConfigError",
        message:
          "Error reported; free-form diagnostic text omitted to protect user content",
      }),
    );
    expect(createServer).not.toHaveBeenCalled();
  });

  it("rethrows a failure it does not know", async () => {
    vi.mocked(initializePagesRuntime).mockRejectedValue(
      new Error("Unexpected disk failure."),
    );

    await expect(
      startPagesServer({
        argumentList: [],
        build: SERVER_BUILD,
        clientDirectory: "/srv/client",
      }),
    ).rejects.toThrow("Unexpected disk failure.");
  });

  it("reads the default configuration from the home directory", async () => {
    const { runtime } = createRuntime(COMPLETED);
    vi.mocked(initializePagesRuntime).mockResolvedValue(runtime);
    vi.mocked(createServer).mockReturnValue(createFakeServer().server);
    vi.spyOn(console, "info").mockReturnValue(undefined);

    await startPagesServer({
      argumentList: [],
      build: SERVER_BUILD,
      clientDirectory: "/srv/client",
    });

    expect(initializePagesRuntime).toHaveBeenCalledWith(
      "/home/pages/.pages/config.toml",
    );
  });

  it("reads the configuration named by --config", async () => {
    const { runtime } = createRuntime(COMPLETED);
    vi.mocked(initializePagesRuntime).mockResolvedValue(runtime);
    vi.mocked(createServer).mockReturnValue(createFakeServer().server);
    vi.spyOn(console, "info").mockReturnValue(undefined);

    await startPagesServer({
      argumentList: ["--config=/etc/pages/custom.toml"],
      build: SERVER_BUILD,
      clientDirectory: "/srv/client",
    });

    expect(initializePagesRuntime).toHaveBeenCalledWith(
      "/etc/pages/custom.toml",
    );
  });
});

describe("startPagesServer: listening", () => {
  beforeEach(() => {
    vi.mocked(createRequestListener).mockReturnValue(vi.fn());
  });

  it("listens on the configured port and keeps the configuration", async () => {
    const info = vi.spyOn(console, "info").mockReturnValue(undefined);
    const { runtime, update } = createRuntime(COMPLETED);
    const { server, listenedPorts } = createFakeServer();
    vi.mocked(initializePagesRuntime).mockResolvedValue(runtime);
    vi.mocked(createServer).mockReturnValue(server);

    const code = await startPagesServer({
      argumentList: [],
      build: SERVER_BUILD,
      clientDirectory: "/srv/client",
    });

    expect(code).toBe(0);
    expect(listenedPorts).toEqual([4100]);
    expect(update).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      "[pages] Pages is running at http://localhost:4100.",
    );
  });

  it("lets --port win over the configuration and stores it", async () => {
    vi.spyOn(console, "info").mockReturnValue(undefined);
    const { runtime, update } = createRuntime(COMPLETED);
    const { server, listenedPorts } = createFakeServer();
    vi.mocked(initializePagesRuntime).mockResolvedValue(runtime);
    vi.mocked(createServer).mockReturnValue(server);

    const code = await startPagesServer({
      argumentList: ["--port", "5200"],
      build: SERVER_BUILD,
      clientDirectory: "/srv/client",
    });

    expect(code).toBe(0);
    expect(listenedPorts).toEqual([5200]);
    const change = update.mock.calls[0]?.[0];
    expect(change?.(COMPLETED)).toEqual({ ...COMPLETED, port: 5200 });
  });

  it("does not rewrite the file when --port equals the stored port", async () => {
    vi.spyOn(console, "info").mockReturnValue(undefined);
    const { runtime, update } = createRuntime(COMPLETED);
    vi.mocked(initializePagesRuntime).mockResolvedValue(runtime);
    vi.mocked(createServer).mockReturnValue(createFakeServer().server);

    await startPagesServer({
      argumentList: ["--port=4100"],
      build: SERVER_BUILD,
      clientDirectory: "/srv/client",
    });

    expect(update).not.toHaveBeenCalled();
  });

  it("starts anyway when the port could not be stored", async () => {
    vi.spyOn(console, "info").mockReturnValue(undefined);
    const warn = vi.spyOn(console, "warn").mockReturnValue(undefined);
    const { runtime, update } = createRuntime(COMPLETED);
    update.mockRejectedValue(new ConfigError("read-only file system"));
    vi.mocked(initializePagesRuntime).mockResolvedValue(runtime);
    vi.mocked(createServer).mockReturnValue(createFakeServer().server);

    const code = await startPagesServer({
      argumentList: ["--port", "5200"],
      build: SERVER_BUILD,
      clientDirectory: "/srv/client",
    });

    expect(code).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      "[pages] The port 5200 could not be stored.",
      expect.objectContaining({
        type: "ConfigError",
        message:
          "Error reported; free-form diagnostic text omitted to protect user content",
      }),
    );
  });

  it("prints pending setup links to stdout after the server starts", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const { runtime } = createRuntime(PENDING);
    vi.mocked(initializePagesRuntime).mockResolvedValue(runtime);
    vi.mocked(createServer).mockReturnValue(createFakeServer().server);

    await startPagesServer({
      argumentList: [],
      build: SERVER_BUILD,
      clientDirectory: "/srv/client",
    });

    const lines = stdout.mock.calls.map((call) => String(call[0]));
    expect(lines).toContain(
      "[pages] Pages is not set up yet. Open the setup wizard with this one-time link:\n",
    );
    expect(lines).toContain(
      `[pages]   http://localhost:3000/setup?token=${runtime.getSetupToken() ?? ""}\n`,
    );
  });
});

describe("startPagesServer: port problems", () => {
  beforeEach(() => {
    vi.mocked(createRequestListener).mockReturnValue(vi.fn());
  });

  it.each([
    ["EADDRINUSE", "Port 4100 is already in use"],
    ["EACCES", "Port 4100 cannot be used without more privileges"],
  ])("explains %s and does not store a port", async (code, message) => {
    const error = vi.spyOn(console, "error").mockReturnValue(undefined);
    const { runtime, update } = createRuntime(COMPLETED);
    vi.mocked(initializePagesRuntime).mockResolvedValue(runtime);
    vi.mocked(createServer).mockReturnValue(
      createFakeServer({ error: listenError(code) }).server,
    );

    const exitCode = await startPagesServer({
      argumentList: ["--port", "4100"],
      build: SERVER_BUILD,
      clientDirectory: "/srv/client",
    });

    expect(exitCode).toBe(1);
    expect(String(error.mock.calls[0]?.[0])).toContain(message);
    expect(update).not.toHaveBeenCalled();
  });

  it("rethrows an unknown listen failure", async () => {
    const { runtime } = createRuntime(COMPLETED);
    vi.mocked(initializePagesRuntime).mockResolvedValue(runtime);
    vi.mocked(createServer).mockReturnValue(
      createFakeServer({ error: listenError("EMFILE") }).server,
    );

    await expect(
      startPagesServer({
        argumentList: [],
        build: SERVER_BUILD,
        clientDirectory: "/srv/client",
      }),
    ).rejects.toThrow("listen EMFILE");
  });
});
