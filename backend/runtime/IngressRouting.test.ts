import { EventEmitter } from "node:events";

import { beforeEach, expect, it, vi } from "vitest";

import { logCaughtError } from "@/backend/logging/Logger";

import { createIngressServer } from "./Ingress";
import { serveAppDocument } from "./AppDocument";
import { refuseMissingAsset, serveStaticAsset } from "./StaticAssets";

import type { Mock } from "vitest";

interface FakeRequest extends EventEmitter {
  url: string | undefined;
  method: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress: string | undefined };
  pipe: Mock;
}

interface FakeResponse extends EventEmitter {
  headersSent: boolean;
  writableFinished: boolean;
  writeHead: Mock;
  end: Mock;
  flushHeaders: Mock;
  destroy: Mock;
}

interface FakeUpstream extends EventEmitter {
  setNoDelay: Mock;
  destroy: Mock;
  end: Mock;
}

type Listener = (request: FakeRequest, response: FakeResponse) => void;

interface RequestOptions {
  host: string;
  port: string;
  path: string;
}

interface HttpState {
  listener: Listener | undefined;
  server: (EventEmitter & { requestTimeout: number }) | undefined;
  upstream: FakeUpstream | undefined;
  requestOptions: RequestOptions[];
}

const http = vi.hoisted((): HttpState => ({
  listener: undefined,
  server: undefined,
  upstream: undefined,
  requestOptions: [],
}));

const routes = vi.hoisted(() => ({ isForwarded: vi.fn() }));

vi.mock("node:http", () => ({
  Agent: class Agent {},
  createServer: vi.fn((listener: Listener) => {
    http.listener = listener;
    return http.server;
  }),
  request: vi.fn((options: RequestOptions) => {
    http.requestOptions.push(options);
    return http.upstream;
  }),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
  logFileProbeError: vi.fn(),
}));
vi.mock("./StaticAssets", () => ({
  serveStaticAsset: vi.fn(),
  refuseMissingAsset: vi.fn(),
}));
vi.mock("./AppDocument", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  serveAppDocument: vi.fn(),
}));
vi.mock("./AppRoutes", () => ({
  AppRoutes: class AppRoutes {
    public readonly isForwarded = routes.isForwarded;
  },
}));

const BACKEND = new URL("http://127.0.0.1:3100");
const CORE = new URL("http://127.0.0.1:3200");
const STATUS = new URL("http://127.0.0.1:3300");

function createRequest(url: string | undefined, method?: string): FakeRequest {
  return Object.assign(new EventEmitter(), {
    url,
    method,
    headers: { host: "pages.test" },
    socket: { remoteAddress: "203.0.113.9" },
    pipe: vi.fn(),
  });
}

function createResponse(): FakeResponse {
  return Object.assign(new EventEmitter(), {
    headersSent: false,
    writableFinished: false,
    writeHead: vi.fn(),
    end: vi.fn(),
    flushHeaders: vi.fn(),
    destroy: vi.fn(),
  });
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

interface Served {
  request: FakeRequest;
  response: FakeResponse;
}

async function serve(
  url: string | undefined,
  options: Parameters<typeof createIngressServer>[0] = {
    clientDirectory: "/client",
    backend: BACKEND,
  },
  method?: string,
): Promise<Served> {
  createIngressServer(options);
  const request = createRequest(url, method);
  const response = createResponse();
  http.listener?.(request, response);
  await flush();
  return { request, response };
}

function targets(): string[] {
  return http.requestOptions.map((entry) => `${entry.host}:${entry.port}`);
}

beforeEach(() => {
  http.listener = undefined;
  http.requestOptions = [];
  http.server = Object.assign(new EventEmitter(), { requestTimeout: 300_000 });
  http.upstream = Object.assign(new EventEmitter(), {
    setNoDelay: vi.fn(),
    destroy: vi.fn(),
    end: vi.fn(),
  });
  vi.mocked(serveStaticAsset).mockResolvedValue(false);
  vi.mocked(refuseMissingAsset).mockReturnValue(false);
  vi.mocked(serveAppDocument).mockResolvedValue(false);
  routes.isForwarded.mockResolvedValue(true);
});

it("returns the server without a request timeout so live streams stay open", () => {
  const server = createIngressServer({
    clientDirectory: "/client",
    backend: BACKEND,
  });

  expect(server).toBe(http.server);
  expect(http.server?.requestTimeout).toBe(0);
});

it("answers 400 for a path that cannot be decoded and logs the cause", async () => {
  const { response } = await serve("/%E0%A4%A");

  expect(response.writeHead).toHaveBeenCalledWith(400, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  expect(response.end).toHaveBeenCalledWith("Bad Request");
  expect(logCaughtError).toHaveBeenCalledWith("Ingress", expect.any(URIError));
  expect(http.requestOptions).toEqual([]);
});

it("passes the service status and its details to the configured core", async () => {
  const options = {
    clientDirectory: "/client",
    backend: BACKEND,
    serviceStatus: STATUS,
  };

  await serve("/service-status", options);
  await serve("/service-status/details", options);

  expect(targets()).toEqual(["127.0.0.1:3300", "127.0.0.1:3300"]);
});

it("answers 404 for the service status when no core reports it", async () => {
  const { response } = await serve("/service-status/details");

  expect(response.writeHead).toHaveBeenCalledWith(404, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
  });
  expect(response.end).toHaveBeenCalledWith("Not Found");
  expect(http.requestOptions).toEqual([]);
});

it("never passes the core's own API paths on, even with every switch set", async () => {
  const { response } = await serve("/api/core/restart", {
    clientDirectory: "/client",
    backend: BACKEND,
    core: CORE,
    serviceStatus: STATUS,
  });

  expect(response.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  expect(response.end).toHaveBeenCalledWith("Not Found");
  expect(http.requestOptions).toEqual([]);
});

it("decodes the path before it checks for the core's API prefix", async () => {
  const { response } = await serve("/%61pi/core/x");

  expect(response.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
  expect(response.end).toHaveBeenCalledWith("Not Found");
  expect(http.requestOptions).toEqual([]);
});

it("sends the live stream to the core when one is set", async () => {
  await serve("/live-changes", {
    clientDirectory: "/client",
    backend: BACKEND,
    core: CORE,
  });

  expect(targets()).toEqual(["127.0.0.1:3200"]);
  expect(serveStaticAsset).not.toHaveBeenCalled();
});

it("sends the live stream to the API when no core is set", async () => {
  await serve("/live-changes");

  expect(targets()).toEqual(["127.0.0.1:3100"]);
});

it("stops after a static asset was served", async () => {
  vi.mocked(serveStaticAsset).mockResolvedValue(true);

  await serve("/assets/app.js");

  expect(serveStaticAsset).toHaveBeenCalledWith(
    expect.objectContaining({ url: "/assets/app.js" }),
    expect.anything(),
    "/client",
  );
  expect(refuseMissingAsset).not.toHaveBeenCalled();
  expect(http.requestOptions).toEqual([]);
});

it("stops after a missing asset was refused", async () => {
  vi.mocked(refuseMissingAsset).mockReturnValue(true);

  await serve("/assets/gone.js");

  expect(routes.isForwarded).not.toHaveBeenCalled();
  expect(http.requestOptions).toEqual([]);
});

it("serves the app document for a page the app renders", async () => {
  routes.isForwarded.mockResolvedValue(false);
  vi.mocked(serveAppDocument).mockResolvedValue(true);

  await serve("/projects/1?tab=x");

  expect(routes.isForwarded).toHaveBeenCalledWith("GET", "/projects/1");
  expect(serveAppDocument).toHaveBeenCalledWith(
    { method: "GET", pathname: "/projects/1" },
    expect.anything(),
    "/client",
  );
  expect(http.requestOptions).toEqual([]);
});

it("falls back to the API when the app has no document to serve", async () => {
  routes.isForwarded.mockResolvedValue(false);

  await serve("/projects/1");

  expect(targets()).toEqual(["127.0.0.1:3100"]);
});

it("forwards a request the API owns without trying the document", async () => {
  await serve("/projects/1", undefined, "POST");

  expect(routes.isForwarded).toHaveBeenCalledWith("POST", "/projects/1");
  expect(serveAppDocument).not.toHaveBeenCalled();
  expect(targets()).toEqual(["127.0.0.1:3100"]);
});

it("treats a request without target as the root path", async () => {
  routes.isForwarded.mockResolvedValue(false);
  vi.mocked(serveAppDocument).mockResolvedValue(true);

  await serve(undefined);

  expect(routes.isForwarded).toHaveBeenCalledWith("GET", "/");
});

it("answers 500 when handling fails before any header was sent", async () => {
  const failure = new Error("disk gone");
  vi.mocked(serveStaticAsset).mockRejectedValue(failure);

  const { response } = await serve("/assets/app.js");

  expect(logCaughtError).toHaveBeenCalledWith("Ingress", failure);
  expect(response.writeHead).toHaveBeenCalledWith(500, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  expect(response.end).toHaveBeenCalledWith("Internal Server Error");
  expect(response.destroy).not.toHaveBeenCalled();
});

it("destroys the response when handling fails after headers were sent", async () => {
  vi.mocked(serveStaticAsset).mockRejectedValue(new Error("late failure"));
  createIngressServer({ clientDirectory: "/client", backend: BACKEND });
  const request = createRequest("/assets/app.js");
  const response = createResponse();
  response.headersSent = true;

  http.listener?.(request, response);
  await flush();

  expect(response.destroy).toHaveBeenCalledOnce();
  expect(response.writeHead).not.toHaveBeenCalled();
});
