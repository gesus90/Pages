import { createServer } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteError } from "@/backend/error/RemoteErrors";

import { installRemoteConsoleChannel } from "./RemoteConsoleChannel";

import type { Server } from "node:http";
import type { RemoteConsoleEvent } from "@/definition/RemoteConsole";

const hub = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class FakeChannel {
    public readonly OPEN = 1;
    public readyState = 1;
    public bufferedAmount = 0;
    public readonly send = vi.fn();
    public readonly close = vi.fn();
    public readonly terminate = vi.fn();
    public readonly ping = vi.fn();
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
    getAuthenticatedUser: vi.fn<(request: Request) => Promise<unknown>>(),
    getApplicationServices: vi.fn<() => Promise<unknown>>(),
    registerShutdownTask:
      vi.fn<(task: () => Promise<void>, options: { step: string }) => void>(),
    logCaughtError: vi.fn(),
  };
});

vi.mock("ws", () => ({ WebSocketServer: hub.FakeServer }));
vi.mock("@/app/lib/auth.server", () => ({
  getAuthenticatedUser: hub.getAuthenticatedUser,
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: hub.getApplicationServices,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: hub.logCaughtError,
}));
vi.mock("./ProcessLifecycle", () => ({
  registerShutdownTask: hub.registerShutdownTask,
}));

const WORKSPACE = "0b3f1c52-7a4e-4d0e-9a55-3c1d2e4f5a66";
const SESSION = "5d2f7a0e-1b4c-4e8a-8f3d-9a6b7c8d9e01";
const OTHER_SESSION = "6e3a8b1f-2c5d-4f9b-9a4e-0b7c8d9eaf12";
const CONSOLE_STATE = {
  status: "connected",
  attempts: 0,
  message: null,
  exitCode: null,
  directory: null,
  setup: null,
} as const;

class FakeSession {
  public readonly unfollow = vi.fn();
  public readonly replay = vi.fn();
  public readonly view = vi.fn(() => CONSOLE_STATE);
  public readonly resize = vi.fn();
  public readonly write = vi.fn();
  public readonly follow = vi.fn(
    (after: number, deliver: (event: RemoteConsoleEvent) => void) => {
      this.deliver = deliver;
      return this.unfollow;
    },
  );
  private deliver: ((event: RemoteConsoleEvent) => void) | null = null;

  /** Hands an event to the follower of the session. */
  public push(event: RemoteConsoleEvent): void {
    if (!this.deliver) throw new Error("The session is not followed.");
    this.deliver(event);
  }
}

interface FakeSocket {
  readonly end: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
}

interface UpgradeOptions {
  readonly query?: string;
  readonly headers?: Record<string, string>;
  readonly omitHeaders?: readonly string[];
}

type FakeChannelInstance = InstanceType<typeof hub.FakeChannel>;

const consoles = { require: vi.fn() };
let server: Server;
let session: FakeSession;

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function createRequest(options: UpgradeOptions): object {
  const headers: Record<string, string> = {
    host: "pages.test",
    origin: "http://pages.test",
    cookie: "sid=1",
    ...options.headers,
  };
  for (const name of options.omitHeaders ?? []) delete headers[name];
  return {
    url: `/agents/workspaces/${WORKSPACE}/console/socket${options.query ?? `?sessionId=${SESSION}&after=5`}`,
    headers,
    socket: { remoteAddress: "10.0.0.1" },
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

beforeEach(() => {
  vi.useFakeTimers();
  hub.FakeServer.instances.length = 0;
  session = new FakeSession();
  consoles.require.mockResolvedValue(session);
  hub.getAuthenticatedUser.mockResolvedValue({
    id: "user-1",
    mustChangePassword: false,
  });
  hub.getApplicationServices.mockResolvedValue({
    remoteConsoleService: consoles,
  });
  server = createServer();
  installRemoteConsoleChannel(server);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("upgrade admission", () => {
  it("configures a bounded, non-compressing socket server", () => {
    expect(hub.FakeServer.instances[0]?.options).toEqual({
      noServer: true,
      maxPayload: 64 * 1024,
      perMessageDeflate: false,
    });
  });

  it("leaves upgrades of other paths untouched", async () => {
    const socket = { end: vi.fn(), destroy: vi.fn() };
    server.emit("upgrade", { url: "/other" }, socket, Buffer.alloc(0));
    await settle();
    expect(socket.end).not.toHaveBeenCalled();
    expect(hub.getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("opens a channel for a signed-in owner and checks ownership", async () => {
    const channel = await openChannel();
    expect(consoles.require).toHaveBeenCalledWith(
      "user-1",
      { kind: "workspace", id: WORKSPACE },
      SESSION,
    );
    expect(session.follow).toHaveBeenCalledWith(5, expect.any(Function));
    expect(channel.close).not.toHaveBeenCalled();
  });

  it("starts the replay cursor at zero when none is given", async () => {
    await openChannel({ query: `?sessionId=${SESSION}` });
    expect(session.follow).toHaveBeenCalledWith(0, expect.any(Function));
  });

  it("forwards the session cookie to the authentication", async () => {
    await openChannel();
    const request = hub.getAuthenticatedUser.mock.calls[0]?.[0];
    expect(request?.headers.get("cookie")).toBe("sid=1");
    expect(request?.url).toBe("http://pages.test/");
  });

  it("authenticates with an empty cookie when none was sent", async () => {
    await openChannel({ omitHeaders: ["cookie"] });
    const request = hub.getAuthenticatedUser.mock.calls[0]?.[0];
    expect(request?.headers.get("cookie")).toBe("");
  });
});

describe("upgrade refusals", () => {
  it.each([
    ["a foreign origin", { headers: { origin: "http://evil.test" } }],
    ["a missing origin", { headers: { origin: "" } }],
    [
      "a https origin without a trusted proxy",
      {
        headers: { origin: "https://pages.test", "x-forwarded-proto": "https" },
      },
    ],
  ])("refuses %s with 403", async (name, options) => {
    const socket = await upgrade(options);
    expect(socket.end).toHaveBeenCalledWith(
      "HTTP/1.1 403 Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
    expect(hub.getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("refuses a request without a host header", async () => {
    const socket = await upgrade({ omitHeaders: ["host"] });
    expect(socket.end).toHaveBeenCalledWith(expect.stringContaining(" 403 "));
  });

  it("ignores an upgrade without a request target and still admits a console one", async () => {
    const socket = { end: vi.fn(), destroy: vi.fn() };
    const request = {
      url: undefined,
      headers: { host: "pages.test", origin: "http://pages.test" },
      socket: { remoteAddress: "10.0.0.1" },
    };
    server.emit("upgrade", request, socket, Buffer.alloc(0));
    await settle();
    expect(socket.end).not.toHaveBeenCalled();
    expect(hub.getAuthenticatedUser).not.toHaveBeenCalled();
    expect(hub.FakeServer.instances[0]?.channels).toHaveLength(0);
    await openChannel();
    expect(hub.FakeServer.instances[0]?.channels).toHaveLength(1);
  });

  it.each([
    ["a missing session id", "?after=1"],
    ["a malformed session id", "?sessionId=abc"],
    ["a negative cursor", `?sessionId=${SESSION}&after=-1`],
    ["a fractional cursor", `?sessionId=${SESSION}&after=1.5`],
    ["a non-numeric cursor", `?sessionId=${SESSION}&after=x`],
  ])("refuses %s with 400", async (name, query) => {
    const socket = await upgrade({ query });
    expect(socket.end).toHaveBeenCalledWith(expect.stringContaining(" 400 "));
    expect(consoles.require).not.toHaveBeenCalled();
  });

  it("refuses a missing user and a user who must change the password", async () => {
    hub.getAuthenticatedUser.mockResolvedValueOnce(null);
    const anonymous = await upgrade();
    hub.getAuthenticatedUser.mockResolvedValueOnce({
      id: "user-1",
      mustChangePassword: true,
    });
    const locked = await upgrade();
    expect(anonymous.end).toHaveBeenCalledWith(
      expect.stringContaining(" 403 "),
    );
    expect(locked.end).toHaveBeenCalledWith(expect.stringContaining(" 403 "));
    expect(consoles.require).not.toHaveBeenCalled();
  });

  it("answers with the status of the remote error of the ownership check", async () => {
    consoles.require.mockRejectedValueOnce(
      new RemoteError("remote_workspace_not_found"),
    );
    const socket = await upgrade();
    expect(socket.end).toHaveBeenCalledWith(expect.stringContaining(" 404 "));
  });
});

describe("upgrade limits and deadline", () => {
  it("refuses with 409 once the channel limit is reached", async () => {
    const instance = hub.FakeServer.instances[0];
    for (let index = 0; index < 100; index += 1)
      instance?.clients.add(new hub.FakeChannel());
    const socket = await upgrade();
    expect(socket.end).toHaveBeenCalledWith(expect.stringContaining(" 409 "));
    expect(hub.getAuthenticatedUser).not.toHaveBeenCalled();
  });

  it("accepts a https origin behind a trusted proxy", async () => {
    hub.FakeServer.instances.length = 0;
    server = createServer();
    installRemoteConsoleChannel(server, ["10.0.0.1"]);
    const socket = await upgrade({
      headers: { origin: "https://pages.test", "x-forwarded-proto": "https" },
    });
    expect(socket.end).not.toHaveBeenCalled();
    expect(hub.FakeServer.instances[0]?.channels).toHaveLength(1);
  });

  it("destroys a socket whose admission takes longer than ten seconds", async () => {
    hub.getAuthenticatedUser.mockReturnValue(new Promise(() => undefined));
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

describe("shutdown", () => {
  it("terminates every channel and closes the server", async () => {
    const channel = await openChannel();
    const [task, options] = hub.registerShutdownTask.mock.calls[0] ?? [];
    expect(options).toEqual({ step: "remote_console_channel" });
    hub.FakeServer.instances[0]?.clients.add(channel);
    await task?.();
    expect(channel.terminate).toHaveBeenCalledOnce();
    expect(hub.FakeServer.instances[0]?.close).toHaveBeenCalledOnce();
  });
});

describe("channel ownership", () => {
  it("closes the previous channel of the same console with 4001", async () => {
    const first = await openChannel();
    const second = await openChannel();
    expect(first.close).toHaveBeenCalledWith(4001, "Console opened elsewhere");
    expect(second.close).not.toHaveBeenCalled();
  });

  it("forgets a closed channel and unfollows the session", async () => {
    const first = await openChannel();
    first.emit("close");
    const second = await openChannel();
    expect(session.unfollow).toHaveBeenCalledOnce();
    expect(first.close).not.toHaveBeenCalled();
    expect(second.close).not.toHaveBeenCalled();
  });

  it("keeps the newer channel when the superseded one closes later", async () => {
    const first = await openChannel();
    const second = await openChannel();
    first.emit("close");
    const third = await openChannel();
    expect(second.close).toHaveBeenCalledWith(4001, "Console opened elsewhere");
    expect(third.close).not.toHaveBeenCalled();
  });

  it("keeps distinct consoles independent", async () => {
    const first = await openChannel();
    await openChannel({ query: `?sessionId=${OTHER_SESSION}` });
    expect(first.close).not.toHaveBeenCalled();
  });

  it("logs a channel error with its component", async () => {
    const channel = await openChannel();
    const failure = new Error("socket failed");
    channel.emit("error", failure);
    expect(hub.logCaughtError).toHaveBeenCalledWith(
      "RemoteConsoleChannel",
      failure,
    );
  });
});

describe("liveness and recurring checks", () => {
  it("pings, rechecks the rights and keeps a channel that answered", async () => {
    const channel = await openChannel();
    consoles.require.mockClear();
    await vi.advanceTimersByTimeAsync(15_000);
    channel.emit("pong");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(channel.ping).toHaveBeenCalledTimes(2);
    expect(consoles.require).toHaveBeenCalledTimes(2);
    expect(channel.terminate).not.toHaveBeenCalled();
  });

  it("terminates a channel that missed a pong", async () => {
    const channel = await openChannel();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(channel.terminate).toHaveBeenCalledOnce();
  });

  it("stops the timer when the channel closes", async () => {
    const channel = await openChannel();
    channel.emit("close");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(channel.ping).not.toHaveBeenCalled();
  });

  it("closes with 4003 when the recurring rights check fails", async () => {
    const channel = await openChannel();
    consoles.require.mockRejectedValueOnce(
      new RemoteError("remote_access_denied"),
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(channel.close).toHaveBeenCalledWith(4003, "Console refused");
  });
});
