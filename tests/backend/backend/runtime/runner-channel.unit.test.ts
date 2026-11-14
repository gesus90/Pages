import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { installRunnerChannel } from "@/backend/runtime/RunnerChannel";

import { createStaticExchange } from "./static-asset-exchange";

const mocks = vi.hoisted(() => ({
  services: vi.fn(),
  authenticate: vi.fn(),
  receive: vi.fn(),
  disconnected: vi.fn(),
  detach: vi.fn(),
  heartbeat: vi.fn(),
  attach: vi.fn(),
  log: vi.fn(),
  register: vi.fn(),
  upgrade: vi.fn(),
}));

vi.mock("ws", () => ({
  WebSocketServer: class {
    public clients = new Set();
    public handleUpgrade = mocks.upgrade;
    public close = vi.fn();
  },
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: mocks.services,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logEvent: mocks.log,
  logCaughtError: vi.fn(),
}));
vi.mock("@/backend/runtime/ProcessLifecycle", () => ({
  registerShutdownTask: mocks.register,
}));

const connectionId = "11111111-1111-1111-1111-111111111111";

function createChannel(): EventEmitter & {
  OPEN: number;
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
} {
  return Object.assign(new EventEmitter(), {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ connectionId, sessionId: "session" });
  mocks.receive.mockResolvedValue({ type: "reconciled" });
  mocks.attach.mockReturnValue(vi.fn());
  mocks.services.mockResolvedValue({
    runnerService: {
      authenticate: mocks.authenticate,
      receive: mocks.receive,
      disconnected: mocks.disconnected,
      detach: mocks.detach,
      heartbeat: mocks.heartbeat,
      attach: mocks.attach,
    },
    runnerPagesAccessService: {
      receive: vi.fn().mockResolvedValue({ type: "pages-reply" }),
    },
    runnerOpenRouterService: { attach: mocks.attach, receive: vi.fn() },
    runnerGitHubAccessService: { attach: mocks.attach, receive: vi.fn() },
  });
});

describe("runner channel", () => {
  it("rejects an upgrade without credentials", async () => {
    const server = createServer();
    installRunnerChannel(server);
    const exchange = createStaticExchange(
      "GET",
      `/runner/v1/channel/${connectionId}`,
    );
    const socket = new PassThrough();
    const end = vi.spyOn(socket, "end");
    server.emit("upgrade", exchange.request, socket, Buffer.alloc(0));
    await vi.waitFor(() =>
      expect(end).toHaveBeenCalledWith(
        expect.stringContaining("401 Unauthorized"),
      ),
    );
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it("authenticates, reconciles, responds to heartbeats and detaches on close", async () => {
    const server = createServer();
    installRunnerChannel(server);
    const channel = createChannel();
    mocks.upgrade.mockImplementation(
      (
        request: unknown,
        socket: unknown,
        head: unknown,
        callback: (channel: EventEmitter) => void,
      ) => callback(channel),
    );
    const exchange = createStaticExchange(
      "GET",
      `/runner/v1/channel/${connectionId}`,
    );
    exchange.request.headers["sec-websocket-protocol"] =
      "pages-runner.v1, credential.secret";
    server.emit(
      "upgrade",
      exchange.request,
      new PassThrough(),
      Buffer.alloc(0),
    );
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledOnce());
    expect(mocks.authenticate).toHaveBeenCalledWith(connectionId, "secret");
    expect(JSON.parse(channel.send.mock.calls[0][0])).toMatchObject({
      type: "registered",
      sessionId: "session",
    });
    channel.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "reconcile" })),
      false,
    );
    await vi.waitFor(() => expect(mocks.attach).toHaveBeenCalledTimes(3));
    expect(mocks.receive).toHaveBeenCalledWith(connectionId, {
      type: "reconcile",
    });
    channel.emit(
      "message",
      Buffer.from(
        JSON.stringify({ type: "heartbeat", version: 1, sessionId: "session" }),
      ),
      false,
    );
    expect(mocks.heartbeat).toHaveBeenCalledWith(connectionId);
    expect(JSON.parse(channel.send.mock.lastCall?.[0])).toEqual({
      type: "heartbeat",
      version: 1,
      sessionId: "session",
    });
    channel.emit("close");
    expect(mocks.detach).toHaveBeenCalledWith(connectionId);
    expect(mocks.disconnected).toHaveBeenCalledTimes(2);
  });
});
