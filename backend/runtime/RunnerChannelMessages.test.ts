import { createServer } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installRunnerChannel } from "./RunnerChannel";

import type { Server } from "node:http";

const hub = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class FakeChannel {
    public readonly OPEN = 1;
    public readyState = 1;
    public bufferedAmount = 0;
    public readonly send = vi.fn();
    public readonly close = vi.fn();
    public readonly terminate = vi.fn();
    private readonly listeners = new Map<string, Listener[]>();

    /** Registers a listener like an event emitter. */
    public on(event: string, listener: Listener): this {
      this.listeners.set(event, [
        ...(this.listeners.get(event) ?? []),
        listener,
      ]);
      return this;
    }

    /** Registers a listener that the fake never needs to remove. */
    public once(event: string, listener: Listener): this {
      return this.on(event, listener);
    }

    /** Calls the listeners of an event, as the socket would. */
    public emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
  }

  class FakeServer {
    public static instances: FakeServer[] = [];
    public static prepare: ((channel: FakeChannel) => void) | null = null;
    public readonly clients = new Set<FakeChannel>();
    public readonly channels: FakeChannel[] = [];
    public readonly close = vi.fn();
    public readonly handleUpgrade = vi.fn(
      (
        request: unknown,
        socket: unknown,
        head: unknown,
        callback: (channel: FakeChannel) => void,
      ): void => {
        const channel = new FakeChannel();
        FakeServer.prepare?.(channel);
        this.channels.push(channel);
        callback(channel);
      },
    );
    public readonly options: unknown;

    public constructor(options: unknown) {
      this.options = options;
      FakeServer.instances.push(this);
    }
  }

  return {
    FakeChannel,
    FakeServer,
    getApplicationServices: vi.fn(),
    registerShutdownTask:
      vi.fn<(task: () => Promise<void>, options: { step: string }) => void>(),
    logCaughtError: vi.fn(),
    logEvent: vi.fn(),
  };
});

vi.mock("ws", () => ({ WebSocketServer: hub.FakeServer }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: hub.getApplicationServices,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: hub.logCaughtError,
  logEvent: hub.logEvent,
}));
vi.mock("./ProcessLifecycle", () => ({
  registerShutdownTask: hub.registerShutdownTask,
}));

const CONNECTION = "0b3f1c52-7a4e-4d0e-9a55-3c1d2e4f5a66";
const AUTH = {
  connectionId: CONNECTION,
  runnerId: "runner-1",
  token: "next-token",
  sessionId: "session-1",
};
const PROTOCOLS = "pages-runner.v1, credential.secret";
const HOUR = 3_600_000;

type FakeChannelInstance = InstanceType<typeof hub.FakeChannel>;

interface FakeSocket {
  readonly end: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
}

interface UpgradeOptions {
  readonly url?: string | null;
  readonly headers?: Record<string, string>;
  readonly remoteAddress?: string;
}

type AttachSender = (
  connectionId: string,
  send: (command: unknown) => void,
) => () => void;

const detachRunner = vi.fn();
const detachProvider = vi.fn();
const detachGitHub = vi.fn();
const runners = {
  authenticate: vi.fn(),
  attach: vi.fn<AttachSender>(),
  disconnected: vi.fn(),
  detach: vi.fn(),
  heartbeat: vi.fn(),
  receive: vi.fn(),
};
const pages = { receive: vi.fn() };
const maintenance = { receive: vi.fn() };
const openRouter = { attach: vi.fn<AttachSender>(), receive: vi.fn() };
const github = { attach: vi.fn<AttachSender>(), receive: vi.fn() };
let server: Server;
let clock = Date.parse("2030-01-01T00:00:00Z");

interface Gate<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function createGate<T>(): Gate<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function createRequest(options: UpgradeOptions): object {
  return {
    url:
      options.url === null
        ? undefined
        : (options.url ?? `/runner/v1/channel/${CONNECTION}`),
    headers: { "sec-websocket-protocol": PROTOCOLS, ...options.headers },
    socket: { remoteAddress: options.remoteAddress ?? "10.0.0.5" },
  };
}

async function upgrade(options: UpgradeOptions = {}): Promise<FakeSocket> {
  const socket = { end: vi.fn(), destroy: vi.fn() };
  server.emit("upgrade", createRequest(options), socket, Buffer.alloc(0));
  await settle();
  return socket;
}

async function openChannel(
  options: UpgradeOptions = {},
): Promise<FakeChannelInstance> {
  await upgrade(options);
  const channel = hub.FakeServer.instances[0]?.channels.at(-1);
  if (!channel) throw new Error("No channel was opened.");
  return channel;
}

function sendJson(channel: FakeChannelInstance, message: unknown): void {
  channel.emit("message", Buffer.from(JSON.stringify(message)), false);
}

async function reconcile(channel: FakeChannelInstance): Promise<void> {
  sendJson(channel, { version: 1, type: "reconcile" });
  await settle();
}

function sentPackets(channel: FakeChannelInstance): unknown[] {
  return channel.send.mock.calls.map((call) => JSON.parse(String(call[0])));
}

beforeEach(() => {
  vi.useFakeTimers();
  clock += HOUR;
  vi.setSystemTime(clock);
  hub.FakeServer.instances.length = 0;
  hub.FakeServer.prepare = null;
  runners.authenticate.mockResolvedValue(AUTH);
  runners.attach.mockReturnValue(detachRunner);
  runners.receive.mockResolvedValue({ type: "reconciled" });
  openRouter.attach.mockReturnValue(detachProvider);
  github.attach.mockReturnValue(detachGitHub);
  hub.getApplicationServices.mockResolvedValue({
    runnerService: runners,
    runnerPagesAccessService: pages,
    runnerMaintenanceService: maintenance,
    runnerOpenRouterService: openRouter,
    runnerGitHubAccessService: github,
  });
  server = createServer();
  installRunnerChannel(server);
});

afterEach(() => {
  vi.useRealTimers();
});

const INVALID_PACKET = "Invalid runner packet";
const CHECKPOINT_FAILED = "Runner checkpoint failed; see Pages diagnostics";
const HEARTBEAT = { version: 1, type: "heartbeat", sessionId: "session-1" };

describe("reconciliation", () => {
  it("answers a reconcile packet and attaches the three senders once", async () => {
    runners.receive.mockResolvedValue({ type: "reconciled", id: 1 });
    const channel = await openChannel();
    await reconcile(channel);
    await reconcile(channel);
    expect(runners.receive).toHaveBeenCalledWith(CONNECTION, {
      version: 1,
      type: "reconcile",
    });
    expect(sentPackets(channel).slice(1)).toEqual([
      { type: "reconciled", id: 1 },
      { type: "reconciled", id: 1 },
    ]);
    expect(runners.attach).toHaveBeenCalledOnce();
    expect(openRouter.attach).toHaveBeenCalledOnce();
    expect(github.attach).toHaveBeenCalledOnce();
  });

  it.each([
    ["a number", 5],
    ["null", null],
    ["an object without a type", { version: 1 }],
    ["another type", { type: "maintenance" }],
    ["a heartbeat", HEARTBEAT],
  ])(
    "closes with 1011 when %s arrives before reconciliation",
    async (name, packet) => {
      const channel = await openChannel();
      sendJson(channel, packet);
      await settle();
      expect(runners.receive).not.toHaveBeenCalled();
      expect(channel.close).toHaveBeenCalledWith(1011, CHECKPOINT_FAILED);
      expect(hub.logCaughtError).toHaveBeenCalledWith(
        "RunnerChannel",
        new Error("Runner reconciliation required"),
      );
    },
  );

  it("closes with 1011 and logs when the service fails", async () => {
    const failure = new Error("database down");
    runners.receive.mockRejectedValueOnce(failure);
    const channel = await openChannel();
    await reconcile(channel);
    expect(hub.logCaughtError).toHaveBeenCalledWith("RunnerChannel", failure);
    expect(channel.close).toHaveBeenCalledWith(1011, CHECKPOINT_FAILED);
    expect(openRouter.attach).not.toHaveBeenCalled();
  });

  it("forwards a failing reply because the channel is blocked", async () => {
    const channel = await openChannel();
    runners.receive.mockImplementationOnce(() => {
      channel.readyState = 3;
      return Promise.resolve({ type: "reconciled" });
    });
    await reconcile(channel);
    expect(channel.close).toHaveBeenCalledWith(1011, CHECKPOINT_FAILED);
    expect(runners.attach).not.toHaveBeenCalled();
  });

  it("sends nothing and stays unreconciled when superseded while waiting", async () => {
    const gate = createGate<unknown>();
    runners.receive.mockReturnValueOnce(gate.promise);
    const first = await openChannel();
    sendJson(first, { version: 1, type: "reconcile" });
    await settle();
    await openChannel();
    gate.resolve({ type: "reconciled" });
    await settle();
    expect(first.send).toHaveBeenCalledTimes(1);
    expect(runners.attach).not.toHaveBeenCalled();
    expect(first.close).not.toHaveBeenCalled();
  });

  it("fails a queued packet that was superseded before it ran", async () => {
    const gate = createGate<unknown>();
    runners.receive.mockReturnValueOnce(gate.promise);
    const first = await openChannel();
    sendJson(first, { version: 1, type: "reconcile" });
    sendJson(first, { version: 1, type: "reconcile" });
    await settle();
    await openChannel();
    gate.resolve({ type: "reconciled" });
    await settle();
    expect(first.close).toHaveBeenCalledWith(1011, CHECKPOINT_FAILED);
    expect(hub.logCaughtError).toHaveBeenCalledWith(
      "RunnerChannel",
      new Error("Runner channel superseded"),
    );
    expect(runners.receive).toHaveBeenCalledOnce();
  });
});

describe("invalid packets", () => {
  it("closes with 1008 for a binary frame", async () => {
    const channel = await openChannel();
    channel.emit("message", Buffer.from("{}"), true);
    await settle();
    expect(channel.close).toHaveBeenCalledWith(1008, INVALID_PACKET);
    expect(runners.receive).not.toHaveBeenCalled();
  });

  it("closes with 1008 for text that is not JSON", async () => {
    const channel = await openChannel();
    channel.emit("message", Buffer.from("{nope"), false);
    await settle();
    expect(channel.close).toHaveBeenCalledWith(1008, INVALID_PACKET);
  });

  it("closes with 1008 for a packet of a superseded channel", async () => {
    const first = await openChannel();
    await openChannel();
    sendJson(first, { version: 1, type: "reconcile" });
    await settle();
    expect(first.close).toHaveBeenCalledWith(1008, INVALID_PACKET);
    expect(runners.receive).not.toHaveBeenCalled();
  });

  it("limits the queue to 32 unfinished packets and recovers afterwards", async () => {
    const gate = createGate<unknown>();
    runners.receive.mockReturnValueOnce(gate.promise);
    const channel = await openChannel();
    for (let index = 0; index < 32; index += 1)
      sendJson(channel, { version: 1, type: "reconcile" });
    expect(channel.close).not.toHaveBeenCalled();
    sendJson(channel, { version: 1, type: "reconcile" });
    expect(channel.close).toHaveBeenCalledWith(1008, "Runner queue limit");
    gate.resolve({ type: "reconciled" });
    await settle();
    channel.close.mockClear();
    sendJson(channel, { version: 1, type: "reconcile" });
    await settle();
    expect(channel.close).not.toHaveBeenCalled();
    expect(runners.receive).toHaveBeenCalledTimes(33);
  });
});

describe("heartbeats", () => {
  it("answers a heartbeat of the session without queueing it", async () => {
    const channel = await openChannel();
    await reconcile(channel);
    channel.send.mockClear();
    sendJson(channel, HEARTBEAT);
    expect(runners.heartbeat).toHaveBeenCalledWith(CONNECTION);
    expect(sentPackets(channel)).toEqual([HEARTBEAT]);
    expect(runners.receive).toHaveBeenCalledOnce();
  });

  it("closes with 1008 when the heartbeat reply cannot be sent", async () => {
    const channel = await openChannel();
    await reconcile(channel);
    channel.readyState = 3;
    sendJson(channel, HEARTBEAT);
    expect(channel.close).toHaveBeenCalledWith(1008, INVALID_PACKET);
  });

  it.each([
    ["a number", 5],
    ["null", null],
    ["an object without a type", { version: 1 }],
    ["another type", { ...HEARTBEAT, type: "status" }],
    ["a heartbeat without a version", { type: "heartbeat" }],
    ["a heartbeat of another version", { ...HEARTBEAT, version: 2 }],
    ["a heartbeat without a session", { type: "heartbeat", version: 1 }],
    ["a heartbeat of another session", { ...HEARTBEAT, sessionId: "other" }],
  ])("hands %s to the service instead", async (name, packet) => {
    const channel = await openChannel();
    await reconcile(channel);
    sendJson(channel, packet);
    await settle();
    expect(runners.heartbeat).not.toHaveBeenCalled();
    expect(runners.receive).toHaveBeenLastCalledWith(CONNECTION, packet);
  });

  it("terminates a channel silent for more than 45 seconds", async () => {
    const channel = await openChannel();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(channel.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(channel.terminate).toHaveBeenCalledOnce();
  });

  it("counts a heartbeat or a reconciliation as sign of life", async () => {
    const channel = await openChannel();
    await vi.advanceTimersByTimeAsync(30_000);
    await reconcile(channel);
    await vi.advanceTimersByTimeAsync(30_000);
    sendJson(channel, HEARTBEAT);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(channel.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(channel.terminate).toHaveBeenCalledOnce();
  });
});

describe("auxiliary packets after reconciliation", () => {
  it.each([
    ["maintenance", maintenance, true],
    ["pages-request", pages, true],
    ["github-access-result", github, false],
    ["openrouter-result", openRouter, false],
  ])("routes %s to its service", async (type, service, hasReply) => {
    service.receive.mockResolvedValue({ type: `${type}-reply` });
    const channel = await openChannel();
    await reconcile(channel);
    channel.send.mockClear();
    const packet = { type, id: 7 };
    sendJson(channel, packet);
    await settle();
    expect(service.receive).toHaveBeenCalledWith(CONNECTION, packet);
    expect(sentPackets(channel)).toEqual(
      hasReply ? [{ type: `${type}-reply` }] : [],
    );
    expect(runners.receive).toHaveBeenCalledOnce();
  });

  it("closes the channel when an auxiliary reply exceeds two mebibytes", async () => {
    pages.receive.mockResolvedValue({ body: "x".repeat(2 * 1024 * 1024) });
    const channel = await openChannel();
    await reconcile(channel);
    sendJson(channel, { type: "pages-request" });
    await settle();
    expect(channel.close).toHaveBeenCalledWith(
      1011,
      "Runner transport blocked; reconciliation required",
    );
    expect(channel.close).toHaveBeenCalledWith(1011, CHECKPOINT_FAILED);
  });
});

describe("senders", () => {
  async function captureSend(
    channel: FakeChannelInstance,
  ): Promise<(command: unknown) => void> {
    await reconcile(channel);
    const send = runners.attach.mock.calls[0]?.[1];
    if (typeof send !== "function") throw new Error("No sender attached.");
    return (command) => send(command);
  }

  it("passes the connection to every sender and writes commands to the socket", async () => {
    const channel = await openChannel();
    const send = await captureSend(channel);
    send({ type: "run" });
    expect(openRouter.attach).toHaveBeenCalledWith(
      CONNECTION,
      expect.any(Function),
    );
    expect(github.attach).toHaveBeenCalledWith(
      CONNECTION,
      expect.any(Function),
    );
    expect(sentPackets(channel).at(-1)).toEqual({ type: "run" });
  });

  it("refuses commands once the channel was superseded", async () => {
    const channel = await openChannel();
    const send = await captureSend(channel);
    await openChannel();
    expect(() => send({ type: "run" })).toThrow("Runner channel superseded");
  });

  it("detaches the senders and the runner when the current channel closes", async () => {
    const channel = await openChannel();
    await reconcile(channel);
    runners.disconnected.mockClear();
    channel.emit("close");
    expect(detachProvider).toHaveBeenCalledOnce();
    expect(detachGitHub).toHaveBeenCalledOnce();
    expect(detachRunner).toHaveBeenCalledOnce();
    expect(runners.detach).toHaveBeenCalledWith(CONNECTION);
    expect(runners.disconnected).toHaveBeenCalledWith(CONNECTION);
  });

  it("closes cleanly before any reconciliation", async () => {
    const channel = await openChannel();
    channel.emit("close");
    expect(detachRunner).not.toHaveBeenCalled();
    expect(runners.detach).toHaveBeenCalledWith(CONNECTION);
  });

  it("leaves the runner state to the newer channel when a superseded one closes", async () => {
    const first = await openChannel();
    await reconcile(first);
    await openChannel();
    runners.disconnected.mockClear();
    first.emit("close");
    expect(detachRunner).toHaveBeenCalledOnce();
    expect(runners.detach).not.toHaveBeenCalled();
    expect(runners.disconnected).not.toHaveBeenCalled();
  });

  it("stops the liveness timer when the channel closes", async () => {
    const channel = await openChannel();
    channel.emit("close");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(channel.terminate).not.toHaveBeenCalled();
  });

  it("logs a channel error with its component", async () => {
    const channel = await openChannel();
    const failure = new Error("socket reset");
    channel.emit("error", failure);
    expect(hub.logCaughtError).toHaveBeenCalledWith("RunnerChannel", failure);
  });
});
