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

interface UpgradeOptions {
  readonly query?: string;
}

type FakeChannelInstance = InstanceType<typeof hub.FakeChannel>;

const consoles = { require: vi.fn() };
let server: Server;
let session: FakeSession;

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
    url: `/agents/workspaces/${WORKSPACE}/console/socket${options.query ?? `?sessionId=${SESSION}&after=5`}`,
    headers: {
      host: "pages.test",
      origin: "http://pages.test",
      cookie: "sid=1",
    },
    socket: { remoteAddress: "10.0.0.1" },
  };
}

async function upgrade(options: UpgradeOptions = {}): Promise<void> {
  const socket = { end: vi.fn(), destroy: vi.fn() };
  server.emit("upgrade", createRequest(options), socket, Buffer.alloc(0));
  await settle();
}

async function openChannel(
  options: UpgradeOptions = {},
): Promise<FakeChannelInstance> {
  await upgrade(options);
  const channel = hub.FakeServer.instances[0]?.channels.at(-1);
  if (!channel) throw new Error("No channel was opened.");
  return channel;
}

function sendCommand(channel: FakeChannelInstance, command: object): void {
  channel.emit("message", Buffer.from(JSON.stringify(command)), false);
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

const HIGH_WATER = 128 * 1024;

function output(sequence: number, length: number): RemoteConsoleEvent {
  return { kind: "output", sequence, chunk: "x".repeat(length) };
}

function sentPayloads(channel: FakeChannelInstance): unknown[] {
  return channel.send.mock.calls.map((call) => JSON.parse(String(call[0])));
}

function sendInput(channel: FakeChannelInstance, text: string): void {
  sendCommand(channel, { type: "input", attempt: 0, data: text });
}

describe("input and geometry", () => {
  it("writes input with its shell attempt", async () => {
    const channel = await openChannel();
    sendCommand(channel, { type: "input", attempt: 2, data: "ls\n" });
    await settle();
    expect(session.write).toHaveBeenCalledWith("ls\n", 2);
  });

  it("applies a resize with the validated size", async () => {
    const channel = await openChannel();
    sendCommand(channel, { type: "resize", columns: 80, rows: 24 });
    await settle();
    expect(session.resize).toHaveBeenCalledWith({
      type: "resize",
      columns: 80,
      rows: 24,
    });
  });

  it("keeps the order in which input and geometry were typed", async () => {
    const calls: string[] = [];
    session.write.mockImplementation((text: string) => calls.push(text));
    session.resize.mockImplementation(() => calls.push("resize"));
    const channel = await openChannel();
    sendInput(channel, "a");
    sendCommand(channel, { type: "resize", columns: 80, rows: 24 });
    sendInput(channel, "b");
    await settle();
    expect(calls).toEqual(["a", "resize", "b"]);
  });

  it("drops a refused write and keeps the channel usable", async () => {
    session.write.mockImplementationOnce(() => {
      throw new Error("outdated attempt");
    });
    const channel = await openChannel();
    sendInput(channel, "a");
    sendInput(channel, "b");
    await settle();
    expect(session.write).toHaveBeenCalledTimes(2);
    expect(channel.close).not.toHaveBeenCalled();
  });

  it.each([
    ["a binary frame", Buffer.from("{}"), true],
    ["an array buffer", new ArrayBuffer(2), false],
    ["a fragmented frame", [Buffer.from("{}")], false],
    ["malformed JSON", Buffer.from("{nope"), false],
    ["an unknown command", Buffer.from('{"type":"kill"}'), false],
    [
      "empty input",
      Buffer.from('{"type":"input","attempt":0,"data":""}'),
      false,
    ],
  ])("denies %s with 4003", async (name, frame, isBinary) => {
    const channel = await openChannel();
    channel.emit("message", frame, isBinary);
    await settle();
    expect(channel.close).toHaveBeenCalledWith(4003, "Console refused");
    expect(session.write).not.toHaveBeenCalled();
  });
});

describe("rights validity", () => {
  it("writes at once within one second of the last check", async () => {
    const channel = await openChannel();
    consoles.require.mockClear();
    await vi.advanceTimersByTimeAsync(1_000);
    sendInput(channel, "a");
    await settle();
    expect(session.write).toHaveBeenCalledOnce();
    expect(consoles.require).not.toHaveBeenCalled();
  });

  it("renews in the background between one and two seconds", async () => {
    const channel = await openChannel();
    consoles.require.mockClear();
    await vi.advanceTimersByTimeAsync(1_500);
    sendInput(channel, "a");
    await settle();
    expect(session.write).toHaveBeenCalledOnce();
    expect(consoles.require).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(900);
    sendInput(channel, "b");
    await settle();
    expect(consoles.require).toHaveBeenCalledOnce();
  });

  it("holds input back until a new check passed after two seconds", async () => {
    const channel = await openChannel();
    const next = new FakeSession();
    const gate = createGate<FakeSession>();
    consoles.require.mockClear();
    consoles.require.mockReturnValueOnce(gate.promise);
    await vi.advanceTimersByTimeAsync(2_500);
    sendInput(channel, "a");
    await settle();
    expect(session.write).not.toHaveBeenCalled();
    gate.resolve(next);
    await settle();
    expect(next.write).toHaveBeenCalledWith("a", 0);
    expect(session.write).not.toHaveBeenCalled();
    expect(consoles.require).toHaveBeenCalledOnce();
  });

  it("drops input and closes the channel when the check fails", async () => {
    const channel = await openChannel();
    consoles.require.mockRejectedValueOnce(
      new RemoteError("remote_access_denied"),
    );
    await vi.advanceTimersByTimeAsync(2_500);
    sendInput(channel, "a");
    await settle();
    expect(session.write).not.toHaveBeenCalled();
    expect(channel.close).toHaveBeenCalledWith(4003, "Console refused");
  });
});

describe("pending command limit", () => {
  it("denies the 65th unfinished command and counts finished ones down", async () => {
    const channel = await openChannel();
    const gate = createGate<FakeSession>();
    consoles.require.mockReturnValueOnce(gate.promise);
    await vi.advanceTimersByTimeAsync(2_500);
    for (let index = 0; index < 64; index += 1) sendInput(channel, "a");
    await settle();
    expect(channel.close).not.toHaveBeenCalled();
    sendInput(channel, "overflow");
    expect(channel.close).toHaveBeenCalledWith(4003, "Console refused");
    gate.resolve(session);
    await settle();
    expect(session.write).toHaveBeenCalledTimes(64);
    channel.close.mockClear();
    sendInput(channel, "again");
    await settle();
    expect(session.write).toHaveBeenCalledTimes(65);
    expect(channel.close).not.toHaveBeenCalled();
  });

  it("does not count acknowledgements as pending commands", async () => {
    const channel = await openChannel();
    for (let index = 0; index < 100; index += 1)
      sendCommand(channel, { type: "ack", characters: 1 });
    await settle();
    expect(channel.close).not.toHaveBeenCalled();
  });
});

describe("output delivery", () => {
  it("sends events as JSON in order", async () => {
    const channel = await openChannel();
    session.push(output(6, 3));
    session.push({ kind: "gap", sequence: 7 });
    expect(sentPayloads(channel)).toEqual([
      { kind: "output", sequence: 6, chunk: "xxx" },
      { kind: "gap", sequence: 7 },
    ]);
  });

  it("sends nothing to a channel that is no longer open", async () => {
    const channel = await openChannel();
    channel.readyState = 3;
    session.push(output(6, 3));
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("disconnects a peer whose buffer exceeds one mebibyte", async () => {
    const channel = await openChannel();
    channel.bufferedAmount = 1024 * 1024 + 1;
    session.push(output(6, 3));
    expect(channel.send).not.toHaveBeenCalled();
    expect(channel.close).toHaveBeenCalledWith(4008, "Console output overflow");
  });

  it("still sends at exactly one mebibyte buffered", async () => {
    const channel = await openChannel();
    channel.bufferedAmount = 1024 * 1024;
    session.push(output(6, 3));
    expect(channel.send).toHaveBeenCalledOnce();
    expect(channel.close).not.toHaveBeenCalled();
  });

  it("closes normally after the ended state and keeps open for others", async () => {
    const channel = await openChannel();
    session.push({ kind: "state", sequence: 6, state: CONSOLE_STATE });
    expect(channel.close).not.toHaveBeenCalled();
    session.push({
      kind: "state",
      sequence: 7,
      state: { ...CONSOLE_STATE, status: "ended" },
    });
    expect(channel.close).toHaveBeenCalledWith(1000, "Console ended");
  });
});

describe("output back pressure", () => {
  it("does not hold at exactly the high water mark", async () => {
    const channel = await openChannel();
    session.push(output(6, HIGH_WATER));
    session.push(output(7, 1));
    expect(channel.send).toHaveBeenCalledTimes(2);
  });

  it("holds events above the high water mark", async () => {
    const channel = await openChannel();
    session.push(output(6, HIGH_WATER + 1));
    session.push(output(7, 1));
    expect(channel.send).toHaveBeenCalledOnce();
  });

  it("releases from the history and repeats the state once the browser caught up", async () => {
    const channel = await openChannel();
    session.replay.mockImplementation(
      (from: number, deliver: (event: RemoteConsoleEvent) => void) => {
        deliver(output(9, 2));
      },
    );
    session.push(output(12, HIGH_WATER + 1));
    sendCommand(channel, { type: "ack", characters: 100_000 });
    expect(session.replay).toHaveBeenCalledWith(12, expect.any(Function));
    expect(sentPayloads(channel).slice(1)).toEqual([
      { kind: "output", sequence: 9, chunk: "xx" },
      { kind: "state", sequence: 12, state: CONSOLE_STATE },
    ]);
  });

  it("replays from the position the browser already had", async () => {
    const channel = await openChannel();
    session.push(output(3, HIGH_WATER + 1));
    sendCommand(channel, { type: "ack", characters: HIGH_WATER + 1 });
    expect(session.replay).toHaveBeenCalledWith(5, expect.any(Function));
  });

  it("keeps holding while the unprocessed output stays above the low water mark", async () => {
    const channel = await openChannel();
    session.push(output(6, HIGH_WATER + 1));
    sendCommand(channel, { type: "ack", characters: 1_000 });
    expect(session.replay).not.toHaveBeenCalled();
    session.push(output(7, 1));
    expect(channel.send).toHaveBeenCalledOnce();
  });

  it("ignores an acknowledgement while nothing is held", async () => {
    const channel = await openChannel();
    sendCommand(channel, { type: "ack", characters: 10 });
    expect(session.replay).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("never counts below zero when more is acknowledged than was sent", async () => {
    const channel = await openChannel();
    session.push(output(6, 10));
    sendCommand(channel, { type: "ack", characters: 1_000_000 });
    session.push(output(7, HIGH_WATER + 1));
    session.push(output(8, 1));
    expect(channel.send).toHaveBeenCalledTimes(2);
  });
});
