import { EventEmitter } from "node:events";

import { beforeEach, expect, it, vi } from "vitest";

import { logEvent } from "@/backend/logging/Logger";

import { createIngressServer } from "./Ingress";
import { refuseMissingAsset, serveStaticAsset } from "./StaticAssets";

import type { IngressOptions } from "./Ingress";
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

interface FakeSocket extends EventEmitter {
  destroyed: boolean;
  write: Mock;
  end: Mock;
  destroy: Mock;
  pipe: Mock;
}

interface FakeAnswer extends EventEmitter {
  statusCode: number | undefined;
  statusMessage: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  pipe: Mock;
}

type Listener = (request: FakeRequest, response: FakeResponse) => void;

interface RequestOptions {
  agent?: unknown;
  headers: Record<string, string | string[] | undefined>;
  host: string;
  method: string | undefined;
  path: string | undefined;
  port: string;
}

type AnswerCallback = (answer: FakeAnswer) => void;

interface HttpState {
  listener: Listener | undefined;
  callback: AnswerCallback | undefined;
  server: EventEmitter | undefined;
  upstream: FakeUpstream | undefined;
  requestOptions: RequestOptions[];
}

const http = vi.hoisted((): HttpState => ({
  listener: undefined,
  callback: undefined,
  server: undefined,
  upstream: undefined,
  requestOptions: [],
}));

vi.mock("node:http", () => ({
  Agent: class Agent {
    public readonly keepAlive: boolean;

    public constructor(options: { keepAlive: boolean }) {
      this.keepAlive = options.keepAlive;
    }
  },
  createServer: vi.fn((listener: Listener) => {
    http.listener = listener;
    return http.server;
  }),
  request: vi.fn((options: RequestOptions, callback?: AnswerCallback) => {
    http.requestOptions.push(options);
    http.callback = callback;
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
vi.mock("./AppRoutes", () => ({
  AppRoutes: class AppRoutes {
    public readonly isForwarded = vi.fn().mockResolvedValue(true);
  },
}));

const BACKEND = new URL("http://127.0.0.1:3100");
const BASE_OPTIONS: IngressOptions = {
  clientDirectory: "/client",
  backend: BACKEND,
};
const RUNNER_ID = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const RUNNER_URL = `/runner/v1/channel/${RUNNER_ID}`;
const CONSOLE_URL = `/agents/workspaces/${RUNNER_ID}/console/socket`;

function createRequest(
  headers: FakeRequest["headers"] = {},
  peer: { address: string | undefined } = { address: "203.0.113.9" },
): FakeRequest {
  return Object.assign(new EventEmitter(), {
    url: "/projects/1?tab=x",
    method: "POST",
    headers: { host: "pages.test", ...headers },
    socket: { remoteAddress: peer.address },
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

function createSocket(): FakeSocket {
  return Object.assign(new EventEmitter(), {
    destroyed: false,
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    pipe: vi.fn(),
  });
}

function createAnswer(overrides: Partial<FakeAnswer> = {}): FakeAnswer {
  return Object.assign(new EventEmitter(), {
    statusCode: 200,
    statusMessage: "OK",
    headers: {},
    pipe: vi.fn(),
    ...overrides,
  });
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function upstreamOf(): FakeUpstream {
  if (!http.upstream) throw new Error("upstream missing");
  return http.upstream;
}

function sentHeaders(): RequestOptions["headers"] {
  const options = http.requestOptions.at(-1);
  if (!options) throw new Error("no request was made");
  return options.headers;
}

async function forward(
  request: FakeRequest,
  response: FakeResponse = createResponse(),
): Promise<FakeResponse> {
  createIngressServer(BASE_OPTIONS);
  http.listener?.(request, response);
  await flush();
  return response;
}

function answerCallback(): AnswerCallback {
  if (!http.callback) throw new Error("no answer callback");
  return http.callback;
}

beforeEach(() => {
  http.listener = undefined;
  http.callback = undefined;
  http.requestOptions = [];
  http.server = new EventEmitter();
  http.upstream = Object.assign(new EventEmitter(), {
    setNoDelay: vi.fn(),
    destroy: vi.fn(),
    end: vi.fn(),
  });
  vi.mocked(serveStaticAsset).mockResolvedValue(false);
  vi.mocked(refuseMissingAsset).mockReturnValue(false);
});

it("sends the request to the API origin with a reusable agent and streams the body", async () => {
  const request = createRequest();

  await forward(request);

  expect(http.requestOptions[0]).toMatchObject({
    agent: { keepAlive: true },
    host: "127.0.0.1",
    method: "POST",
    path: "/projects/1?tab=x",
    port: "3100",
  });
  expect(upstreamOf().setNoDelay).toHaveBeenCalledWith(true);
  expect(request.pipe).toHaveBeenCalledWith(upstreamOf());
});

it("drops hop-by-hop headers and every header the Connection header names", async () => {
  await forward(
    createRequest({
      connection: "keep-alive, X-Secret-Hop",
      "x-secret-hop": "1",
      "keep-alive": "timeout=5",
      te: "trailers",
      upgrade: "h2c",
      "x-end-to-end": "kept",
      "x-missing": undefined,
    }),
  );

  const headers = sentHeaders();
  expect(headers).toMatchObject({ host: "pages.test", "x-end-to-end": "kept" });
  for (const name of ["connection", "x-secret-hop", "keep-alive", "te"])
    expect(headers).not.toHaveProperty(name);
  expect(headers).not.toHaveProperty("upgrade");
  expect(headers).not.toHaveProperty("x-missing");
});

it("replaces forwarding headers of an untrusted client with the observed peer", async () => {
  await forward(
    createRequest({
      "x-forwarded-for": "1.2.3.4",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "evil.test",
      forwarded: "for=1.2.3.4",
      "x-real-ip": "1.2.3.4",
    }),
  );

  const headers = sentHeaders();
  expect(headers["x-forwarded-for"]).toBe("203.0.113.9");
  expect(headers["x-forwarded-proto"]).toBe("http");
  for (const name of ["x-forwarded-host", "forwarded", "x-real-ip"])
    expect(headers).not.toHaveProperty(name);
});

it("believes a loopback proxy and appends its peer to the client chain", async () => {
  await forward(
    createRequest(
      { "x-forwarded-for": "1.2.3.4", "x-forwarded-proto": "HTTPS, http" },
      { address: "127.0.0.1" },
    ),
  );

  expect(sentHeaders()["x-forwarded-for"]).toBe("1.2.3.4, 127.0.0.1");
  expect(sentHeaders()["x-forwarded-proto"]).toBe("https");
});

it("joins a repeated forwarded-for header of a trusted peer and passes http for other protocols", async () => {
  await forward(
    createRequest(
      { "x-forwarded-for": ["1.1.1.1", "2.2.2.2"], "x-forwarded-proto": "ws" },
      { address: "::1" },
    ),
  );

  expect(sentHeaders()["x-forwarded-for"]).toBe("1.1.1.1, 2.2.2.2, ::1");
  expect(sentHeaders()["x-forwarded-proto"]).toBe("http");
});

it("uses the peer alone for a trusted loopback client without a forwarded-for header", async () => {
  await forward(createRequest({}, { address: "127.0.0.1" }));

  expect(sentHeaders()["x-forwarded-for"]).toBe("127.0.0.1");
});

it("sends an empty client address when the socket has no peer", async () => {
  await forward(createRequest({}, { address: undefined }));

  expect(sentHeaders()["x-forwarded-for"]).toBe("");
  expect(sentHeaders()["x-forwarded-proto"]).toBe("http");
});

it("relays the API answer with its end-to-end headers and streams its body", async () => {
  const response = await forward(createRequest());
  const answer = createAnswer({
    statusCode: 201,
    statusMessage: "Created",
    headers: { "content-type": "text/plain", connection: "close" },
  });

  answerCallback()(answer);

  expect(response.writeHead).toHaveBeenCalledWith(201, "Created", {
    "content-type": "text/plain",
  });
  expect(response.flushHeaders).toHaveBeenCalledOnce();
  expect(answer.pipe).toHaveBeenCalledWith(response);

  answer.emit("error", new Error("reset"));

  expect(response.destroy).toHaveBeenCalledOnce();
});

it("answers 502 when the API gives no status code", async () => {
  const response = await forward(createRequest());

  answerCallback()(createAnswer({ statusCode: undefined }));

  expect(response.writeHead).toHaveBeenCalledWith(
    502,
    "OK",
    expect.any(Object),
  );
});

it("answers 502 uncached and logs a warning when the API is unreachable", async () => {
  const response = await forward(createRequest());
  const failure = new Error("ECONNREFUSED");

  upstreamOf().emit("error", failure);

  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      level: "warn",
      event: "ingress.backend.unavailable",
      error: failure,
    }),
  );
  expect(response.writeHead).toHaveBeenCalledWith(502, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  expect(response.end).toHaveBeenCalledWith("Pages backend unavailable");
});

it("destroys the response when the API fails after headers were sent", async () => {
  const response = createResponse();
  response.headersSent = true;
  await forward(createRequest(), response);

  upstreamOf().emit("error", new Error("reset"));

  expect(response.destroy).toHaveBeenCalledOnce();
  expect(response.writeHead).not.toHaveBeenCalled();
});

it("ends the API request when the browser leaves before the answer finished", async () => {
  const response = await forward(createRequest());

  response.emit("close");

  expect(upstreamOf().destroy).toHaveBeenCalledOnce();
});

it("keeps the API request when the browser connection closes after a complete answer", async () => {
  const response = createResponse();
  response.writableFinished = true;
  await forward(createRequest(), response);

  response.emit("close");

  expect(upstreamOf().destroy).not.toHaveBeenCalled();
});

interface UpgradeSetup {
  request: FakeRequest;
  socket: FakeSocket;
}

function upgrade(
  url: string,
  options: IngressOptions = BASE_OPTIONS,
  head: Buffer = Buffer.alloc(0),
): UpgradeSetup {
  http.server = new EventEmitter();
  createIngressServer(options);
  const request = createRequest({
    upgrade: "websocket",
    connection: "Upgrade",
  });
  request.url = url;
  request.method = "GET";
  const socket = createSocket();
  http.server?.emit("upgrade", request, socket, head);
  return { request, socket };
}

it("refuses an upgrade to the core's API paths and to undecodable paths", () => {
  const core = upgrade("/api/core/stream");
  const broken = upgrade("/%E0%A4%A");

  for (const { socket } of [core, broken])
    expect(socket.end).toHaveBeenCalledWith(
      "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nNot Found",
    );
  expect(http.requestOptions).toEqual([]);
});

it("routes runner and console channels to their core and everything else to the API", () => {
  const options: IngressOptions = {
    ...BASE_OPTIONS,
    coreRunner: new URL("http://127.0.0.1:3201"),
    coreConsole: new URL("http://127.0.0.1:3202"),
  };

  upgrade(RUNNER_URL, options);
  upgrade(CONSOLE_URL, options);
  upgrade("/live/socket", options);

  expect(http.requestOptions.map((entry) => entry.port)).toEqual([
    "3201",
    "3202",
    "3100",
  ]);
});

it("sends runner and console channels to the API without their switches", () => {
  upgrade(RUNNER_URL);
  upgrade(CONSOLE_URL);

  expect(http.requestOptions.map((entry) => entry.port)).toEqual([
    "3100",
    "3100",
  ]);
});

it("marks the upstream upgrade request and ends it at once", () => {
  upgrade(RUNNER_URL);

  expect(http.requestOptions[0]).not.toHaveProperty("agent");
  expect(sentHeaders()).toMatchObject({
    connection: "Upgrade",
    upgrade: "websocket",
    "x-forwarded-proto": "http",
  });
  expect(upstreamOf().end).toHaveBeenCalledOnce();
});

it("sends an empty upgrade header when the browser sent none", () => {
  http.server = new EventEmitter();
  createIngressServer(BASE_OPTIONS);
  const request = createRequest();
  request.url = "/socket";
  http.server?.emit("upgrade", request, createSocket(), Buffer.alloc(0));

  expect(sentHeaders()).toMatchObject({ connection: "Upgrade", upgrade: "" });
});

it("switches protocols, replays buffered bytes and joins both sockets", () => {
  const { socket } = upgrade("/socket", BASE_OPTIONS, Buffer.from("client"));
  const backendSocket = createSocket();

  upstreamOf().emit(
    "upgrade",
    createAnswer({
      statusMessage: "Switching Protocols",
      headers: {
        upgrade: "websocket",
        "set-cookie": ["a=1", "b=2"],
        "x-skipped": undefined,
      },
    }),
    backendSocket,
    Buffer.from("server"),
  );

  expect(socket.write).toHaveBeenNthCalledWith(
    1,
    "HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nset-cookie: a=1\r\nset-cookie: b=2\r\n\r\n",
  );
  expect(socket.write).toHaveBeenNthCalledWith(2, Buffer.from("server"));
  expect(backendSocket.write).toHaveBeenCalledWith(Buffer.from("client"));
  expect(backendSocket.pipe).toHaveBeenCalledWith(socket);
  expect(socket.pipe).toHaveBeenCalledWith(backendSocket);

  backendSocket.emit("error", new Error("reset"));
  socket.emit("close");
  backendSocket.emit("close");

  expect(socket.destroy).toHaveBeenCalledTimes(2);
  expect(backendSocket.destroy).toHaveBeenCalledOnce();
});

it("writes only the status line when nothing was buffered and the status text is missing", () => {
  const { socket } = upgrade("/socket");

  upstreamOf().emit(
    "upgrade",
    createAnswer({ statusMessage: undefined }),
    createSocket(),
    Buffer.alloc(0),
  );

  expect(socket.write).toHaveBeenCalledOnce();
  expect(socket.write).toHaveBeenCalledWith(
    "HTTP/1.1 101 Switching Protocols\r\n\r\n",
  );
});

it("closes the API socket when the browser is gone before the switch", () => {
  const { socket } = upgrade("/socket");
  socket.destroyed = true;
  const backendSocket = createSocket();

  upstreamOf().emit("upgrade", createAnswer(), backendSocket, Buffer.alloc(0));

  expect(backendSocket.destroy).toHaveBeenCalledOnce();
  expect(socket.write).not.toHaveBeenCalled();
});

it("passes a refused upgrade on with its status, then closes", () => {
  const { socket } = upgrade("/socket");
  const answer = createAnswer({
    statusCode: 403,
    statusMessage: "Forbidden",
    headers: { "content-type": "text/plain", connection: "keep-alive" },
  });

  upstreamOf().emit("response", answer);

  expect(socket.write).toHaveBeenCalledWith(
    "HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\nconnection: close\r\n\r\n",
  );
  expect(answer.pipe).toHaveBeenCalledWith(socket);

  answer.emit("error", new Error("reset"));

  expect(socket.destroy).toHaveBeenCalledOnce();
});

it("reports 502 and an empty status text for a refusal without status data", () => {
  const { socket } = upgrade("/socket");

  upstreamOf().emit(
    "response",
    createAnswer({ statusCode: undefined, statusMessage: undefined }),
  );

  expect(socket.write).toHaveBeenCalledWith(
    "HTTP/1.1 502 \r\nconnection: close\r\n\r\n",
  );
});

it("answers an unreachable API with 502 on the browser socket", () => {
  const { socket } = upgrade("/socket");

  upstreamOf().emit("error", new Error("ECONNREFUSED"));

  expect(socket.end).toHaveBeenCalledWith(
    "HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nPages backend unavailable",
  );
});

it("stays silent when the browser socket is already gone and the API fails", () => {
  const { socket } = upgrade("/socket");
  socket.destroyed = true;

  upstreamOf().emit("error", new Error("ECONNREFUSED"));

  expect(socket.end).not.toHaveBeenCalled();
});

it("ends the API request when the browser socket errors or closes", () => {
  const { socket } = upgrade("/socket");

  socket.emit("error", new Error("reset"));
  socket.emit("close");

  expect(upstreamOf().destroy).toHaveBeenCalledTimes(2);
});
