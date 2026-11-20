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
const LOCAL_CONNECTION = "00000000-0000-4000-8000-000000000001";
const AUTH = {
  connectionId: CONNECTION,
  runnerId: "runner-1",
  token: "next-token",
  sessionId: "session-1",
};
const PROTOCOLS = "pages-runner.v1, credential.secret";
const REFUSED =
  "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
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

const detachRunner = vi.fn();
const detachProvider = vi.fn();
const detachGitHub = vi.fn();
const runners = {
  authenticate: vi.fn(),
  attach: vi.fn(),
  disconnected: vi.fn(),
  detach: vi.fn(),
  heartbeat: vi.fn(),
  receive: vi.fn(),
};
const pages = { receive: vi.fn() };
const maintenance = { receive: vi.fn() };
const openRouter = { attach: vi.fn(), receive: vi.fn() };
const github = { attach: vi.fn(), receive: vi.fn() };
let server: Server;
let clock = Date.parse("2030-01-01T00:00:00Z");

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

describe("server setup", () => {
  it("accepts only the runner sub protocol and bounds the payload", () => {
    const options = hub.FakeServer.instances[0]?.options;
    expect(options).toMatchObject({
      noServer: true,
      maxPayload: 2 * 1024 * 1024,
    });
    expect(
      typeof options === "object" &&
        options !== null &&
        "handleProtocols" in options &&
        typeof options.handleProtocols === "function"
        ? options.handleProtocols()
        : null,
    ).toBe("pages-runner.v1");
  });

  it("terminates every channel and closes the server on shutdown", async () => {
    const channel = await openChannel();
    hub.FakeServer.instances[0]?.clients.add(channel);
    const [task, options] = hub.registerShutdownTask.mock.calls[0] ?? [];
    expect(options).toEqual({ step: "runner_channel" });
    await task?.();
    expect(channel.terminate).toHaveBeenCalledOnce();
    expect(hub.FakeServer.instances[0]?.close).toHaveBeenCalledOnce();
  });

  it.each([
    "/agents/workspaces/0b3f1c52-7a4e-4d0e-9a55-3c1d2e4f5a66/console/socket",
    "/chat/conversations/socket",
  ])("leaves the upgrade of %s to its own channel", async (url) => {
    const socket = await upgrade({ url });
    expect(socket.end).not.toHaveBeenCalled();
    expect(runners.authenticate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(socket.destroy).not.toHaveBeenCalled();
  });
});

describe("authentication of the upgrade", () => {
  it("authenticates with the connection and credential of the protocols", async () => {
    const channel = await openChannel({
      headers: {
        "sec-websocket-protocol": "pages-runner.v1,credential.s3cr3t",
      },
    });
    expect(runners.authenticate).toHaveBeenCalledWith(CONNECTION, "s3cr3t");
    expect(channel.close).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing target", { url: null }],
    ["another path", { url: "/runner/v1/other" }],
    ["a query string", { url: `/runner/v1/channel/${CONNECTION}?x=1` }],
    [
      "a missing protocol header",
      { headers: { "sec-websocket-protocol": "" } },
    ],
    [
      "a missing credential",
      { headers: { "sec-websocket-protocol": "pages-runner.v1" } },
    ],
    [
      "a missing runner protocol",
      { headers: { "sec-websocket-protocol": "credential.secret" } },
    ],
    ["a browser origin", { headers: { origin: "http://pages.test" } }],
  ])("refuses %s with 401", async (name, options) => {
    const socket = await upgrade(options);
    expect(socket.end).toHaveBeenCalledWith(REFUSED);
    expect(runners.authenticate).not.toHaveBeenCalled();
  });

  it("refuses a request without any protocol header", async () => {
    const socket = { end: vi.fn(), destroy: vi.fn() };
    const request = {
      url: `/runner/v1/channel/${CONNECTION}`,
      headers: {},
      socket: { remoteAddress: "10.0.0.5" },
    };
    server.emit("upgrade", request, socket, Buffer.alloc(0));
    await settle();
    expect(socket.end).toHaveBeenCalledWith(REFUSED);
  });

  it("refuses a rejected credential", async () => {
    runners.authenticate.mockRejectedValueOnce(new Error("bad credential"));
    const socket = await upgrade();
    expect(socket.end).toHaveBeenCalledWith(REFUSED);
    expect(hub.FakeServer.instances[0]?.handleUpgrade).not.toHaveBeenCalled();
  });

  it("refuses once 200 runner channels are open", async () => {
    const instance = hub.FakeServer.instances[0];
    for (let index = 0; index < 200; index += 1)
      instance?.clients.add(new hub.FakeChannel());
    const socket = await upgrade();
    expect(socket.end).toHaveBeenCalledWith(REFUSED);
    expect(runners.authenticate).not.toHaveBeenCalled();
  });

  it("destroys a socket whose authentication takes longer than ten seconds", async () => {
    runners.authenticate.mockReturnValue(new Promise(() => undefined));
    const socket = await upgrade();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(socket.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it("cancels the deadline once the upgrade finished", async () => {
    const socket = await upgrade();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(socket.destroy).not.toHaveBeenCalled();
  });
});

describe("local runner identity", () => {
  const LOCAL = `/runner/v1/channel/${LOCAL_CONNECTION}`;

  it.each(["127.0.0.1", "::ffff:127.0.0.1"])(
    "admits a direct loopback peer %s",
    async (remoteAddress) => {
      const socket = await upgrade({ url: LOCAL, remoteAddress });
      expect(socket.end).not.toHaveBeenCalled();
      expect(runners.authenticate).toHaveBeenCalledWith(
        LOCAL_CONNECTION,
        "secret",
      );
    },
  );

  it.each([
    ["a remote peer", { remoteAddress: "10.0.0.5" }],
    [
      "a proxied loopback peer",
      {
        remoteAddress: "127.0.0.1",
        headers: { "x-forwarded-for": "203.0.113.9" },
      },
    ],
    [
      "a loopback peer with a forwarded header",
      { remoteAddress: "127.0.0.1", headers: { forwarded: "for=203.0.113.9" } },
    ],
  ])("refuses %s", async (name, options) => {
    const socket = await upgrade({ url: LOCAL, ...options });
    expect(socket.end).toHaveBeenCalledWith(REFUSED);
    expect(runners.authenticate).not.toHaveBeenCalled();
  });
});

describe("refusal notices", () => {
  it("logs one notice per thirty seconds without the credential", async () => {
    await upgrade({ url: "/runner/v1/other" });
    await upgrade({ url: "/runner/v1/other" });
    expect(hub.logEvent).toHaveBeenCalledOnce();
    expect(hub.logEvent).toHaveBeenCalledWith({
      level: "warn",
      event: "runner.channel.rejected",
      component: "RunnerChannel",
      message:
        "Refused a runner connection without a valid registration or credential",
    });
    await vi.advanceTimersByTimeAsync(29_999);
    await upgrade({ url: "/runner/v1/other" });
    expect(hub.logEvent).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await upgrade({ url: "/runner/v1/other" });
    expect(hub.logEvent).toHaveBeenCalledTimes(2);
  });
});

describe("registration", () => {
  it("marks the runner disconnected and registers the session", async () => {
    const channel = await openChannel();
    expect(runners.disconnected).toHaveBeenCalledWith(CONNECTION);
    expect(sentPackets(channel)).toEqual([
      {
        version: 1,
        type: "registered",
        ...AUTH,
        heartbeatMilliseconds: 15_000,
      },
    ]);
  });

  it.each([
    [
      "a channel that is not open",
      (channel: FakeChannelInstance) => {
        channel.readyState = 3;
      },
    ],
    [
      "a peer with a full buffer",
      (channel: FakeChannelInstance) => {
        channel.bufferedAmount = 4 * 1024 * 1024;
      },
    ],
  ])("refuses the upgrade for %s", async (name, prepare) => {
    hub.FakeServer.prepare = prepare;
    const socket = await upgrade();
    const channel = hub.FakeServer.instances[0]?.channels[0];
    expect(channel?.close).toHaveBeenCalledWith(
      1011,
      "Runner transport blocked; reconciliation required",
    );
    expect(channel?.send).not.toHaveBeenCalled();
    expect(socket.end).toHaveBeenCalledWith(REFUSED);
  });

  it("terminates the previous channel of the same connection", async () => {
    const first = await openChannel();
    const second = await openChannel();
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(second.terminate).not.toHaveBeenCalled();
  });

  it("keeps the newer channel registered when the older one closes", async () => {
    const first = await openChannel();
    const second = await openChannel();
    first.emit("close");
    const third = await openChannel();
    expect(second.terminate).toHaveBeenCalledOnce();
    expect(third.terminate).not.toHaveBeenCalled();
  });

  it("forgets a closed channel", async () => {
    const first = await openChannel();
    first.emit("close");
    await openChannel();
    expect(first.terminate).not.toHaveBeenCalled();
  });
});
