import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { networkInterfaces } from "node:os";

import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientSocketAddressContext } from "@/app/lib/client-address.server";
import { requestEntryContext } from "@/app/lib/request-origin.server";
import { DEFAULT_CONFIG } from "@/backend/config/PagesConfig";
import { ConfigFile } from "@/backend/config/ConfigFile";

import {
  announceServer,
  createPagesRequestListener,
  listServerOrigins,
} from "./PagesServer";
import { PagesRuntime } from "./PagesRuntime";

import type { NetworkInterfaceInfoIPv4 } from "node:os";
import type { FetchHandler } from "@remix-run/node-fetch-server";
import type * as OsModule from "node:os";
import type * as ReactRouterModule from "react-router";
import type { ServerBuild } from "react-router";
import type { RequestEntry } from "@/definition/RequestEntry";

const mocks = vi.hoisted(() => ({
  networkInterfaces: vi.fn(() => ({})),
  createRequestListener:
    vi.fn<(handler: FetchHandler, options?: { protocol: string }) => unknown>(),
  createRequestHandler: vi.fn(),
  handleRequest:
    vi.fn<
      (request: Request, context: RouterContextProvider) => Promise<Response>
    >(),
  handleDirect: vi.fn(),
  handleForwardedHttps: vi.fn(),
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  logEvent: vi.fn(),
  isTrustedProxy: vi.fn(),
  isTrustedPeer: vi.fn(),
  isForwardedHttps: vi.fn(),
  createTrustedPeerCheck: vi.fn(),
  createForwardedHttpsCheck: vi.fn(),
  forwardedClientAddress: vi.fn(),
  admitForwardedHeaders: vi.fn(),
  answerDataRedirect: vi.fn(),
  serveStaticAsset: vi.fn(),
  refuseMissingAsset: vi.fn(),
  serveAppDocument: vi.fn(),
  isForwarded: vi.fn(),
  appRoutes: vi.fn(),
  logRequest: vi.fn(),
  withLoggedRoutes: vi.fn(),
}));

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof OsModule>()),
  networkInterfaces: mocks.networkInterfaces,
}));
vi.mock("@remix-run/node-fetch-server", () => ({
  createRequestListener: mocks.createRequestListener,
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouterModule>()),
  createRequestHandler: mocks.createRequestHandler,
}));
vi.mock("@/app/lib/health.server", () => ({ checkHealth: vi.fn() }));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logDiagnostic: mocks.logDiagnostic,
  logEvent: mocks.logEvent,
}));
vi.mock("./AgentToolsStartup", () => ({ startAgentTools: vi.fn() }));
vi.mock("./RunnerChannel", () => ({ installRunnerChannel: vi.fn() }));
vi.mock("./RemoteConsoleChannel", () => ({
  installRemoteConsoleChannel: vi.fn(),
}));
vi.mock("./ConversationWebChannel", () => ({
  installConversationWebChannel: vi.fn(),
}));
vi.mock("./AgentCallChannel", () => ({ installAgentCallChannel: vi.fn() }));
vi.mock("./PicaMobileRuntime", () => ({ startPicaMobile: vi.fn() }));
vi.mock("./AppRoutes", () => ({ AppRoutes: mocks.appRoutes }));
vi.mock("./AppDocument", () => ({
  requestTargetPath: (requestUrl: string | undefined) =>
    (requestUrl ?? "/").split("?")[0],
  serveAppDocument: mocks.serveAppDocument,
}));
vi.mock("./DataRedirect", () => ({
  answerDataRedirect: mocks.answerDataRedirect,
}));
vi.mock("./ForwardedProtocol", () => ({
  admitForwardedHeaders: mocks.admitForwardedHeaders,
  createForwardedHttpsCheck: mocks.createForwardedHttpsCheck,
  createTrustedPeerCheck: mocks.createTrustedPeerCheck,
  forwardedClientAddress: mocks.forwardedClientAddress,
}));
vi.mock("./StaticAssets", () => ({
  refuseMissingAsset: mocks.refuseMissingAsset,
  serveStaticAsset: mocks.serveStaticAsset,
}));
vi.mock("./RequestLogging", () => ({ logRequest: mocks.logRequest }));
vi.mock("./LoggedRoutes", () => ({ withLoggedRoutes: mocks.withLoggedRoutes }));
vi.mock("./ServiceWatchdog", () => ({ startServiceWatchdog: vi.fn() }));
vi.mock("./ProcessLifecycle", () => ({
  installProcessLogging: vi.fn(),
  registerShutdownTask: vi.fn(),
}));

const CLIENT_DIRECTORY = "/srv/pages/client";
const TRUSTED_PROXIES = ["10.0.0.1"];
const SOCKET_ADDRESS = "203.0.113.9";

interface Exchange {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly end: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
}

function createBuild(): ServerBuild {
  const opaqueBuild: unknown = { routes: {} };

  return opaqueBuild as ServerBuild;
}

function createExchange(url: string | undefined, method?: string): Exchange {
  const request = new IncomingMessage(new Socket());
  request.url = url;
  request.method = method;
  const response = new ServerResponse(request);
  const end = vi.fn();
  const destroy = vi.fn();
  vi.spyOn(response, "end").mockImplementation(end);
  vi.spyOn(response, "destroy").mockImplementation(destroy);

  return { request, response, end, destroy };
}

function dispatch(trustedProxies?: readonly string[]): Exchange["request"] {
  const listener = createPagesRequestListener(
    createBuild(),
    CLIENT_DIRECTORY,
    trustedProxies,
  );
  const { request, response } = createExchange("/projects");
  listener(request, response);

  return request;
}

function fetchHandler(): FetchHandler {
  const [handler] = mocks.createRequestListener.mock.calls[0] ?? [];
  if (typeof handler !== "function") {
    throw new Error("The fetch handler was not registered.");
  }

  return handler;
}

function ipv4Interface(
  address: string,
  isInternal: boolean,
): NetworkInterfaceInfoIPv4 {
  return {
    address,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal: isInternal,
    cidr: `${address}/24`,
  };
}

beforeEach(() => {
  mocks.createRequestHandler.mockReturnValue(mocks.handleRequest);
  mocks.withLoggedRoutes.mockImplementation((build: ServerBuild) => build);
  mocks.createTrustedPeerCheck.mockImplementation(
    (proxies: readonly string[], options?: { isLoopbackTrusted: boolean }) =>
      options?.isLoopbackTrusted === true
        ? mocks.isTrustedPeer
        : mocks.isTrustedProxy,
  );
  mocks.createForwardedHttpsCheck.mockReturnValue(mocks.isForwardedHttps);
  mocks.isForwardedHttps.mockReturnValue(false);
  mocks.createRequestListener.mockImplementation(
    (handler: FetchHandler, options?: { protocol: string }) =>
      options === undefined ? mocks.handleDirect : mocks.handleForwardedHttps,
  );
  mocks.appRoutes.mockImplementation(function appRoutes() {
    return { isForwarded: mocks.isForwarded };
  });
  mocks.logRequest.mockImplementation(
    (
      request: IncomingMessage,
      response: ServerResponse,
      handle: () => void,
    ) => {
      handle();
    },
  );
  mocks.serveStaticAsset.mockResolvedValue(false);
  mocks.refuseMissingAsset.mockReturnValue(false);
  mocks.isForwarded.mockResolvedValue(false);
  mocks.serveAppDocument.mockResolvedValue(false);
  mocks.handleDirect.mockResolvedValue(undefined);
  mocks.handleForwardedHttps.mockResolvedValue(undefined);
});

describe("listServerOrigins", () => {
  it("lists localhost first and then only external IPv4 addresses", () => {
    mocks.networkInterfaces.mockReturnValue({
      lo: [ipv4Interface("127.0.0.1", true)],
      eth0: [
        { ...ipv4Interface("192.168.1.20", false) },
        { ...ipv4Interface("fe80::1", false), family: "IPv6" },
      ],
      down: undefined,
    });

    expect(listServerOrigins(3000)).toEqual([
      "http://localhost:3000",
      "http://192.168.1.20:3000",
    ]);
    expect(networkInterfaces).toHaveBeenCalledTimes(1);
  });

  it("lists only localhost without any interface", () => {
    mocks.networkInterfaces.mockReturnValue({});

    expect(listServerOrigins(80)).toEqual(["http://localhost:80"]);
  });
});

describe("announceServer", () => {
  function createRuntime(isFirstRun: boolean): PagesRuntime {
    return new PagesRuntime(
      new ConfigFile("/data/config.toml"),
      isFirstRun
        ? { ...DEFAULT_CONFIG }
        : { ...DEFAULT_CONFIG, firstRun: false, databasePath: "/data/db" },
    );
  }

  it("writes the one-time setup link of every origin straight to stdout", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const runtime = createRuntime(true);
    const token = runtime.getSetupToken();

    announceServer(runtime, ["http://localhost:1", "http://10.0.0.2:1"]);

    expect(mocks.logDiagnostic).toHaveBeenCalledWith(
      "PagesServer",
      "info",
      "[pages] Pages is running at http://localhost:1 and http://10.0.0.2:1.",
    );
    expect(write.mock.calls.map(([text]) => text)).toEqual([
      "[pages] Pages is not set up yet. Open the setup wizard with this one-time link:\n",
      `[pages]   http://localhost:1/setup?token=${token}\n`,
      `[pages]   http://10.0.0.2:1/setup?token=${token}\n`,
    ]);
  });

  it("prints no link once the setup is finished", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    announceServer(createRuntime(false), ["http://localhost:1"]);

    expect(mocks.logDiagnostic).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });
});

describe("createPagesRequestListener setup", () => {
  it("builds the handler from the logged production build and trust checks", () => {
    const build = createBuild();

    createPagesRequestListener(build, CLIENT_DIRECTORY, TRUSTED_PROXIES);

    expect(mocks.withLoggedRoutes).toHaveBeenCalledWith(build);
    expect(mocks.createRequestHandler).toHaveBeenCalledWith(
      build,
      "production",
    );
    expect(mocks.createTrustedPeerCheck).toHaveBeenCalledWith(TRUSTED_PROXIES);
    expect(mocks.createTrustedPeerCheck).toHaveBeenCalledWith(TRUSTED_PROXIES, {
      isLoopbackTrusted: true,
    });
    expect(mocks.createForwardedHttpsCheck).toHaveBeenCalledWith(
      TRUSTED_PROXIES,
    );
    expect(mocks.appRoutes).toHaveBeenCalledWith(CLIENT_DIRECTORY);
  });

  it("trusts no proxy by default", () => {
    createPagesRequestListener(createBuild(), CLIENT_DIRECTORY);

    expect(mocks.createForwardedHttpsCheck).toHaveBeenCalledWith([]);
  });
});

describe("the fetch handler of the application", () => {
  async function handle(url: string): Promise<RouterContextProvider> {
    createPagesRequestListener(createBuild(), CLIENT_DIRECTORY);
    const request = new Request(url, {
      headers: { "x-forwarded-for": "198.51.100.1" },
    });
    mocks.forwardedClientAddress.mockReturnValue("198.51.100.1");
    mocks.handleRequest.mockResolvedValue(new Response("page"));
    mocks.answerDataRedirect.mockReturnValue(new Response("answered"));
    const answer = await fetchHandler()(request, {
      address: SOCKET_ADDRESS,
      family: "IPv4",
      port: 4000,
    });

    expect(await answer.text()).toBe("answered");
    expect(mocks.forwardedClientAddress).toHaveBeenCalledWith(
      SOCKET_ADDRESS,
      "198.51.100.1",
      mocks.isTrustedPeer,
    );

    const [, context] = mocks.handleRequest.mock.calls[0] ?? [];
    if (!(context instanceof RouterContextProvider)) {
      throw new Error("The router context was not passed.");
    }

    return context;
  }

  it("passes the socket peer, entry and an http protocol on a plain connection", async () => {
    const entry: RequestEntry = {
      reportedProtocol: "absent",
      isTrustedProxy: false,
      isForwarded: false,
    };
    mocks.admitForwardedHeaders.mockReturnValue(entry);

    const context = await handle("http://pages.test/a");

    expect(context.get(clientSocketAddressContext)).toBe("198.51.100.1");
    expect(context.get(requestEntryContext)).toBe(entry);
    expect(mocks.admitForwardedHeaders).toHaveBeenCalledWith(
      expect.any(Headers),
      { peer: SOCKET_ADDRESS, protocol: "http" },
      {
        isTrustedProxy: mocks.isTrustedProxy,
        isTrustedClientPeer: mocks.isTrustedPeer,
      },
    );
  });

  it("builds the entry with the https protocol for an https URL", async () => {
    mocks.admitForwardedHeaders.mockReturnValue(null);

    await handle("https://pages.test/a");

    expect(mocks.admitForwardedHeaders).toHaveBeenCalledWith(
      expect.any(Headers),
      { peer: SOCKET_ADDRESS, protocol: "https" },
      expect.anything(),
    );
  });
});

describe("the request listener", () => {
  it("stops after a static asset was served", async () => {
    mocks.serveStaticAsset.mockResolvedValue(true);

    dispatch();
    await vi.waitFor(() => {
      expect(mocks.serveStaticAsset).toHaveBeenCalled();
    });
    await Promise.resolve();

    expect(mocks.refuseMissingAsset).not.toHaveBeenCalled();
    expect(mocks.handleDirect).not.toHaveBeenCalled();
  });

  it("stops after a missing hashed asset was refused", async () => {
    mocks.refuseMissingAsset.mockReturnValue(true);

    dispatch();
    await vi.waitFor(() => {
      expect(mocks.refuseMissingAsset).toHaveBeenCalled();
    });
    await Promise.resolve();

    expect(mocks.isForwarded).not.toHaveBeenCalled();
    expect(mocks.handleDirect).not.toHaveBeenCalled();
  });

  it("serves the app document for a page address that is not forwarded", async () => {
    mocks.serveAppDocument.mockResolvedValue(true);
    const listener = createPagesRequestListener(
      createBuild(),
      CLIENT_DIRECTORY,
    );
    const { request, response } = createExchange("/pair%20code?x=1", "HEAD");

    listener(request, response);
    await vi.waitFor(() => {
      expect(mocks.serveAppDocument).toHaveBeenCalledWith(
        { method: "HEAD", pathname: "/pair code" },
        response,
        CLIENT_DIRECTORY,
      );
    });

    expect(mocks.isForwarded).toHaveBeenCalledWith("HEAD", "/pair code");
    expect(mocks.handleDirect).not.toHaveBeenCalled();
  });

  it("falls back to the application when no document exists", async () => {
    const request = dispatch();

    await vi.waitFor(() => {
      expect(mocks.handleDirect).toHaveBeenCalledTimes(1);
    });

    expect(mocks.serveAppDocument).toHaveBeenCalledTimes(1);
    expect(mocks.handleDirect.mock.calls[0]?.[0]).toBe(request);
    expect(mocks.handleForwardedHttps).not.toHaveBeenCalled();
  });

  it("sends a forwarded address to the application without the document", async () => {
    mocks.isForwarded.mockResolvedValue(true);

    dispatch();
    await vi.waitFor(() => {
      expect(mocks.handleDirect).toHaveBeenCalledTimes(1);
    });

    expect(mocks.serveAppDocument).not.toHaveBeenCalled();
  });

  it("uses the https listener for a request a trusted proxy forwarded from https", async () => {
    mocks.isForwardedHttps.mockReturnValue(true);

    dispatch(TRUSTED_PROXIES);
    await vi.waitFor(() => {
      expect(mocks.handleForwardedHttps).toHaveBeenCalledTimes(1);
    });

    expect(mocks.createRequestListener).toHaveBeenCalledWith(
      expect.any(Function),
      { protocol: "https:" },
    );
    expect(mocks.handleDirect).not.toHaveBeenCalled();
  });

  it("falls back to the root path and the GET method for an unreadable target", async () => {
    mocks.isForwarded.mockResolvedValue(true);
    const listener = createPagesRequestListener(
      createBuild(),
      CLIENT_DIRECTORY,
    );
    const { request, response } = createExchange("/%E0%A4%A");

    listener(request, response);
    await vi.waitFor(() => {
      expect(mocks.isForwarded).toHaveBeenCalledWith("GET", "/");
    });

    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "PagesServer",
      expect.any(URIError),
    );
  });
});

describe("the request listener on failure", () => {
  it("answers 500 when the failure happens before any header was sent", async () => {
    const failure = new Error("static broke");
    mocks.serveStaticAsset.mockRejectedValue(failure);
    const listener = createPagesRequestListener(
      createBuild(),
      CLIENT_DIRECTORY,
    );
    const { request, response, end, destroy } = createExchange("/x");

    listener(request, response);
    await vi.waitFor(() => {
      expect(end).toHaveBeenCalledWith("Internal Server Error");
    });

    expect(response.statusCode).toBe(500);
    expect(destroy).not.toHaveBeenCalled();
    expect(mocks.logCaughtError).toHaveBeenCalledWith("PagesServer", failure);
    expect(mocks.logEvent).toHaveBeenCalledWith({
      level: "error",
      event: "http.request.failed",
      component: "PagesServer",
      message: "Request listener failed",
      error: failure,
    });
  });

  it("destroys the response when headers were already sent", async () => {
    mocks.handleDirect.mockRejectedValue(new Error("late failure"));
    const listener = createPagesRequestListener(
      createBuild(),
      CLIENT_DIRECTORY,
    );
    const { request, response, end, destroy } = createExchange("/x");
    vi.spyOn(response, "headersSent", "get").mockReturnValue(true);

    listener(request, response);
    await vi.waitFor(() => {
      expect(destroy).toHaveBeenCalledTimes(1);
    });

    expect(end).not.toHaveBeenCalled();
  });
});
