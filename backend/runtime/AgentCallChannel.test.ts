import { createServer } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_CALL_SOCKET_PATH } from "@/definition/AgentCall";

import { installAgentCallChannel } from "./AgentCallChannel";

import type { Server } from "node:http";
import type { AgentCallLiveEvent } from "@/definition/AgentCall";

const hub = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");

  class FakeChannel extends EventEmitter {
    public readonly OPEN = 1;
    public readyState = 1;
    public bufferedAmount = 0;
    public readonly send = vi.fn();
    public readonly close = vi.fn();
    public readonly terminate = vi.fn();
    public readonly ping = vi.fn();
  }

  class FakeServer {
    public static instances: FakeServer[] = [];
    public readonly clients = new Set<FakeChannel>();
    public readonly channels: FakeChannel[] = [];
    public readonly close = vi.fn();
    public readonly options: unknown;
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

    public constructor(options: unknown) {
      this.options = options;
      FakeServer.instances.push(this);
    }
  }

  class FakeAuthenticator {
    public static readonly isSessionActive = vi.fn();
    public static resolvers: (() => Promise<unknown>)[] = [];
    public readonly isSessionActive = FakeAuthenticator.isSessionActive;

    public constructor(resolver: () => Promise<unknown>) {
      FakeAuthenticator.resolvers.push(resolver);
    }
  }

  return {
    FakeChannel,
    FakeServer,
    FakeAuthenticator,
    admit: vi.fn(),
    getAuthenticatedUser: vi.fn(),
    openLive: vi.fn(),
    registerShutdownTask:
      vi.fn<(task: () => Promise<void>, options: { step: string }) => void>(),
    logCaughtError: vi.fn(),
    createForwardedHttpsCheck: vi.fn(() => () => false),
  };
});

vi.mock("ws", () => ({ WebSocketServer: hub.FakeServer }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: () =>
    Promise.resolve({
      authService: { getAuthenticatedUser: hub.getAuthenticatedUser },
      agentCallService: { openLive: hub.openLive },
    }),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: hub.logCaughtError,
}));
vi.mock("@/backend/service/mobile/PicaMobileAuthenticator", () => ({
  PagesPicaMobileAuthenticator: hub.FakeAuthenticator,
}));
vi.mock("./ConversationWebChannel", () => ({
  admitConversationWebChannel: hub.admit,
}));
vi.mock("./ForwardedProtocol", () => ({
  createForwardedHttpsCheck: hub.createForwardedHttpsCheck,
}));
vi.mock("./ProcessLifecycle", () => ({
  registerShutdownTask: hub.registerShutdownTask,
}));

const PERSON = { id: "person-1", mustChangePassword: false };
const HELLO = { type: "hello", agentId: "agent-1", callId: "call-1" };

interface FakeSocket {
  readonly end: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
  readonly on: ReturnType<typeof vi.fn>;
}

interface FakeHandle {
  readonly call: Record<string, ReturnType<typeof vi.fn>>;
  readonly hangup: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
}

let server: Server;
let handle: FakeHandle;
let emit: (event: AgentCallLiveEvent) => void;

function createHandle(): FakeHandle {
  const names = ["speech", "pause", "cancel", "played", "audio"];
  const call: Record<string, ReturnType<typeof vi.fn>> = {
    spoken: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
  };
  for (const name of names) call[name] = vi.fn();
  return {
    call,
    hangup: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  };
}

function createSocket(): FakeSocket {
  return { end: vi.fn(), destroy: vi.fn(), on: vi.fn() };
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

async function upgrade(
  url: string | null = AGENT_CALL_SOCKET_PATH,
): Promise<FakeSocket> {
  const socket = createSocket();
  server.emit(
    "upgrade",
    { url: url ?? undefined, headers: {} },
    socket,
    Buffer.alloc(0),
  );
  await settle();
  return socket;
}

async function openChannel(): Promise<InstanceType<typeof hub.FakeChannel>> {
  await upgrade();
  const channel = hub.FakeServer.instances[0]?.channels.at(-1);
  if (!channel) throw new Error("No channel was opened.");
  return channel;
}

async function openCall(): Promise<InstanceType<typeof hub.FakeChannel>> {
  const channel = await openChannel();
  channel.emit("message", Buffer.from(JSON.stringify(HELLO)), false);
  await settle();
  return channel;
}

function text(
  channel: InstanceType<typeof hub.FakeChannel>,
  body: unknown,
): void {
  channel.emit("message", Buffer.from(JSON.stringify(body)), false);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  hub.FakeServer.instances.length = 0;
  hub.admit.mockResolvedValue({ sessionToken: "token" });
  hub.getAuthenticatedUser.mockResolvedValue(PERSON);
  hub.FakeAuthenticator.isSessionActive.mockResolvedValue(true);
  handle = createHandle();
  hub.openLive.mockImplementation(
    (
      person: unknown,
      names: unknown,
      onEvent: (event: AgentCallLiveEvent) => void,
    ) => {
      emit = onEvent;
      return Promise.resolve(handle);
    },
  );
  server = createServer();
  installAgentCallChannel(server);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("installAgentCallChannel upgrades", () => {
  it("passes the trusted proxies on and leaves other paths alone", async () => {
    installAgentCallChannel(createServer(), ["10.0.0.1"]);
    const socket = await upgrade("/other");

    expect(hub.createForwardedHttpsCheck).toHaveBeenCalledWith([]);
    expect(hub.createForwardedHttpsCheck).toHaveBeenCalledWith(["10.0.0.1"]);
    expect(socket.on).not.toHaveBeenCalled();
    expect(hub.admit).not.toHaveBeenCalled();
  });

  it.each([null, "http://[bad"])("ignores the url %s", async (url) => {
    const socket = await upgrade(url);

    expect(socket.on).not.toHaveBeenCalled();
  });

  it("lets the authenticator resolve the authentication service", async () => {
    const resolver = hub.FakeAuthenticator.resolvers.at(-1);

    await expect(resolver?.()).resolves.toEqual({
      getAuthenticatedUser: hub.getAuthenticatedUser,
    });
  });

  it("accepts the channel path with a query", async () => {
    await upgrade(`${AGENT_CALL_SOCKET_PATH}?x=1`);

    expect(hub.FakeServer.instances[0]?.handleUpgrade).toHaveBeenCalled();
  });

  it("destroys a socket that errors or never finishes the upgrade", async () => {
    hub.admit.mockReturnValue(new Promise(() => undefined));
    const socket = await upgrade();
    const onError = socket.on.mock.calls[0]?.[1] as () => void;
    onError();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(socket.destroy).toHaveBeenCalledTimes(2);
  });

  it("refuses with 503 when too many channels are open", async () => {
    const websocket = hub.FakeServer.instances[0];
    for (let index = 0; index < 200; index += 1)
      websocket?.clients.add(new hub.FakeChannel());
    const socket = await upgrade();

    expect(socket.end).toHaveBeenCalledWith(
      expect.stringContaining("HTTP/1.1 503 Refused"),
    );
    expect(hub.logCaughtError).not.toHaveBeenCalled();
  });

  it("answers the status of an admission refusal without logging", async () => {
    hub.admit.mockRejectedValue({ status: 403 });
    const socket = await upgrade();

    expect(socket.end).toHaveBeenCalledWith(
      expect.stringContaining("HTTP/1.1 403 Refused"),
    );
    expect(hub.logCaughtError).not.toHaveBeenCalled();
  });

  it("answers 503 and logs an unexpected failure", async () => {
    hub.admit.mockRejectedValue(new Error("broken"));
    const socket = await upgrade();

    expect(socket.end).toHaveBeenCalledWith(
      expect.stringContaining("HTTP/1.1 503 Refused"),
    );
    expect(hub.logCaughtError).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no person", null],
    ["a person who must change the password", { mustChangePassword: true }],
  ])("refuses %s with 401", async (name, person) => {
    hub.getAuthenticatedUser.mockResolvedValue(person);
    const socket = await upgrade();

    expect(socket.end).toHaveBeenCalledWith(
      expect.stringContaining("HTTP/1.1 401 Refused"),
    );
    expect(hub.logCaughtError).not.toHaveBeenCalled();
  });

  it("terminates every channel at shutdown", async () => {
    const channel = await openChannel();
    hub.FakeServer.instances[0]?.clients.add(channel);
    const [task, options] = hub.registerShutdownTask.mock.calls.at(-1) ?? [];
    await task?.();

    expect(options).toEqual({ step: "agent_call_channel" });
    expect(channel.terminate).toHaveBeenCalled();
    expect(hub.FakeServer.instances[0]?.close).toHaveBeenCalled();
  });
});

describe("AgentCallConnection frames", () => {
  it("closes a connection that never says hello", async () => {
    const channel = await openChannel();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(channel.close).toHaveBeenCalledWith(1008, "hello");
  });

  it("ignores frames that are not valid commands", async () => {
    const channel = await openChannel();
    channel.emit("message", Buffer.from("not json"), false);
    text(channel, { type: "unknown" });
    channel.emit("message", Buffer.from([1, 2, 3]), true);
    await settle();

    expect(hub.openLive).not.toHaveBeenCalled();
  });

  it("opens the call once and replays what arrived meanwhile", async () => {
    const channel = await openChannel();
    channel.emit("message", Buffer.from(JSON.stringify(HELLO)), false);
    channel.emit("message", Buffer.from(JSON.stringify(HELLO)), false);
    text(channel, { type: "speech", turn: 1 });
    await settle();

    expect(hub.openLive).toHaveBeenCalledTimes(1);
    expect(hub.openLive).toHaveBeenCalledWith(
      PERSON,
      { agentId: "agent-1", callId: "call-1" },
      expect.any(Function),
    );
    expect(handle.call.speech).toHaveBeenCalledWith(1);
    text(channel, { type: "speech", turn: 2 });
    expect(handle.call.speech).toHaveBeenCalledWith(2);
    channel.emit("message", Buffer.from(JSON.stringify(HELLO)), false);
    expect(hub.openLive).toHaveBeenCalledTimes(1);
  });

  it("dispatches every command to the call", async () => {
    const channel = await openCall();
    text(channel, { type: "quiet", turn: 1, blocks: 4 });
    text(channel, { type: "cancel", turn: 1 });
    text(channel, { type: "played", turn: 1, index: 2 });
    text(channel, { type: "spoken", turn: 1, spokenCharacters: 9 });
    text(channel, { type: "end", turn: 1, blocks: 5, voicedBlocks: 3 });
    await settle();

    expect(handle.call.pause).toHaveBeenCalledWith(1, 4);
    expect(handle.call.cancel).toHaveBeenCalledWith(1);
    expect(handle.call.played).toHaveBeenCalledWith(1, 2);
    expect(handle.call.spoken).toHaveBeenCalledWith(1, 9);
    expect(handle.call.end).toHaveBeenCalledWith(1, { total: 5, voiced: 3 });
  });

  it("hangs up and closes the channel", async () => {
    const channel = await openCall();
    text(channel, { type: "hangup" });
    await settle();

    expect(handle.hangup).toHaveBeenCalled();
    expect(channel.close).toHaveBeenCalledWith(1000, "hangup");
  });

  it("logs a command that fails", async () => {
    handle.call.end?.mockRejectedValue(new Error("failed"));
    const channel = await openCall();
    text(channel, { type: "end", turn: 1, blocks: 1, voicedBlocks: 1 });
    await settle();

    expect(hub.logCaughtError).toHaveBeenCalledWith(
      "AgentCallChannel",
      expect.any(Error),
    );
    expect(channel.close).not.toHaveBeenCalled();
  });

  it("accepts frames as fragments and as array buffers", async () => {
    const channel = await openChannel();
    channel.emit(
      "message",
      [
        Buffer.from('{"type":"hello","agentId":"a",'),
        Buffer.from('"callId":"c"}'),
      ],
      false,
    );
    await settle();
    const buffer = new TextEncoder().encode(
      '{"type":"speech","turn":3}',
    ).buffer;
    channel.emit("message", buffer, false);

    expect(hub.openLive).toHaveBeenCalledTimes(1);
    expect(handle.call.speech).toHaveBeenCalledWith(3);
  });

  it("hands audio blocks to the call and drops malformed ones", async () => {
    const channel = await openChannel();
    channel.emit("message", Buffer.alloc(12), true);
    const header = Buffer.alloc(8);
    header.writeUInt32LE(7, 0);
    header.writeUInt32LE(9, 4);
    const queued = Buffer.concat([header, Buffer.alloc(4)]);
    channel.emit("message", Buffer.from(JSON.stringify(HELLO)), false);
    channel.emit("message", queued, true);
    await settle();
    channel.emit("message", Buffer.alloc(8), true);
    channel.emit("message", Buffer.alloc(11), true);
    channel.emit("message", queued, true);

    expect(handle.call.audio).toHaveBeenCalledTimes(2);
    expect(handle.call.audio).toHaveBeenCalledWith(7, 9, Buffer.alloc(4));
  });
});

describe("AgentCallConnection lifecycle", () => {
  it("tells the browser when the call cannot be opened", async () => {
    hub.openLive.mockRejectedValue(new Error("no agent"));
    const channel = await openChannel();
    channel.emit("message", Buffer.from(JSON.stringify(HELLO)), false);
    await settle();

    expect(channel.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "closed", code: "agent_unavailable" }),
    );
    expect(channel.close).toHaveBeenCalledWith(1011, "unavailable");
    expect(hub.logCaughtError).toHaveBeenCalled();
  });

  it("releases a call that was opened for a connection that closed", async () => {
    const channel = await openChannel();
    channel.emit("message", Buffer.from(JSON.stringify(HELLO)), false);
    channel.emit("close");
    await settle();

    expect(handle.release).toHaveBeenCalled();
  });

  it("releases the call when the connection closes", async () => {
    const channel = await openCall();
    channel.emit("close");

    expect(handle.release).toHaveBeenCalledTimes(1);
  });

  it("sends events and drops them on a channel that is not open", async () => {
    const channel = await openCall();
    emit({ type: "closed", code: "agent_unavailable" });
    channel.readyState = 3;
    emit({ type: "closed", code: "agent_unavailable" });

    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it("terminates a connection that is too slow", async () => {
    const channel = await openCall();
    channel.bufferedAmount = 5 * 1024 * 1024;
    emit({ type: "closed", code: "agent_unavailable" });

    expect(channel.terminate).toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("logs a channel error", async () => {
    const channel = await openChannel();
    const error = new Error("socket");
    channel.emit("error", error);

    expect(hub.logCaughtError).toHaveBeenCalledWith("AgentCallChannel", error);
  });

  it("probes the connection and ends a silent or ended one", async () => {
    const channel = await openChannel();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(channel.ping).toHaveBeenCalledTimes(1);
    expect(channel.close).not.toHaveBeenCalledWith(1008, "session");

    channel.emit("pong");
    hub.FakeAuthenticator.isSessionActive.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(channel.close).toHaveBeenCalledWith(1008, "session");

    await vi.advanceTimersByTimeAsync(20_000);
    expect(channel.terminate).toHaveBeenCalledTimes(1);
  });

  it("logs a failing session check", async () => {
    hub.FakeAuthenticator.isSessionActive.mockRejectedValue(new Error("db"));
    await openChannel();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(hub.logCaughtError).toHaveBeenCalledWith(
      "AgentCallChannel",
      expect.any(Error),
    );
  });
});
