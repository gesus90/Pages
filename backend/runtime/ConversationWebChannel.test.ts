import { createServer, IncomingMessage } from "node:http";
import { Socket } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PAGES_VERSION } from "@/definition/Version";

import {
  admitConversationWebChannel,
  installConversationWebChannel,
} from "./ConversationWebChannel";

import type { Server } from "node:http";
import type { Mock } from "vitest";
import type { PicaMobileAuthenticator } from "@/backend/service/mobile/PicaMobileAuthenticator";
import type { PicaMobileConversationsProvider } from "@/backend/service/mobile/conversations/PicaMobileConversationsProvider";

const hub = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class FakeChannel {
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

  class FakeConnection {
    public static instances: FakeConnection[] = [];
    public readonly start = vi.fn();
    public readonly stop = vi.fn();
    public readonly receiveText = vi.fn();
    public readonly receiveBinary = vi.fn();
    public readonly receivePong = vi.fn();
    public readonly channel: unknown;
    public readonly settings: Record<string, unknown>;

    public constructor(channel: unknown, settings: Record<string, unknown>) {
      this.channel = channel;
      this.settings = settings;
      FakeConnection.instances.push(this);
    }
  }

  class FakeWebAuthenticator {
    public readonly inner: unknown;
    public readonly sessionToken: unknown;

    public constructor(inner: unknown, sessionToken: unknown) {
      this.inner = inner;
      this.sessionToken = sessionToken;
    }
  }

  class FakePagesAuthenticator {
    public static instances: FakePagesAuthenticator[] = [];
    public readonly isSessionActive = vi.fn();
    public readonly resolveAuthService: () => Promise<unknown>;

    public constructor(resolveAuthService: () => Promise<unknown>) {
      this.resolveAuthService = resolveAuthService;
      FakePagesAuthenticator.instances.push(this);
    }
  }

  return {
    FakeChannel,
    FakeServer,
    FakeConnection,
    FakeWebAuthenticator,
    FakePagesAuthenticator,
    answers: { name: "shared answers" },
    readSessionToken: vi.fn(),
    getApplicationServices: vi.fn<() => Promise<unknown>>(),
    registerShutdownTask:
      vi.fn<(task: () => Promise<void>, options: { step: string }) => void>(),
    logCaughtError: vi.fn(),
    createMobileConversations: vi.fn(),
  };
});

vi.mock("ws", () => ({ WebSocketServer: hub.FakeServer }));
vi.mock("@/app/lib/session.server", () => ({
  readSessionToken: hub.readSessionToken,
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: hub.getApplicationServices,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: hub.logCaughtError,
}));
vi.mock("@/backend/service/conversation/ConversationAnswerStream", () => ({
  sharedConversationAnswerStream: () => hub.answers,
}));
vi.mock("@/backend/service/mobile/PicaMobileAuthenticator", () => ({
  PagesPicaMobileAuthenticator: hub.FakePagesAuthenticator,
}));
vi.mock("@/backend/service/mobile/PicaMobileConnection", () => ({
  PicaMobileConnection: hub.FakeConnection,
}));
vi.mock("@/backend/service/mobile/PicaMobileWebAuthenticator", () => ({
  PicaMobileWebAuthenticator: hub.FakeWebAuthenticator,
}));
vi.mock("./PicaMobileRuntime", () => ({
  createMobileConversations: hub.createMobileConversations,
}));
vi.mock("./ProcessLifecycle", () => ({
  registerShutdownTask: hub.registerShutdownTask,
}));

const REFUSED_PREFIX = "HTTP/1.1 ";
const REFUSED_SUFFIX =
  " Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
const TOKEN = "session-token";

interface UpgradeOptions {
  readonly headers?: Record<string, string>;
  readonly remoteAddress?: string;
  readonly url?: string;
}

interface FakeSocket {
  readonly end: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
  readonly on: Mock<(event: string, handler: () => void) => void>;
}

const authenticator = {
  authenticate: vi.fn<PicaMobileAuthenticator["authenticate"]>(),
  isSessionActive: vi.fn<PicaMobileAuthenticator["isSessionActive"]>(),
};
const conversations: PicaMobileConversationsProvider = {
  answer: vi.fn<PicaMobileConversationsProvider["answer"]>(),
  beginVoice: vi.fn<PicaMobileConversationsProvider["beginVoice"]>(),
  openVoice: vi.fn<PicaMobileConversationsProvider["openVoice"]>(),
  describe: vi.fn<PicaMobileConversationsProvider["describe"]>(),
  follow: vi.fn<PicaMobileConversationsProvider["follow"]>(),
};
let server: Server;

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function refusal(status: number): string {
  return `${REFUSED_PREFIX}${status}${REFUSED_SUFFIX}`;
}

function createHeaders(
  overrides: Record<string, string>,
): Record<string, string> {
  return {
    host: "pages.test",
    origin: "http://pages.test",
    cookie: "sid=1",
    ...overrides,
  };
}

function createRequest(options: UpgradeOptions): object {
  return {
    url: options.url ?? "/chat/conversations/socket",
    headers: createHeaders(options.headers ?? {}),
    socket: { remoteAddress: options.remoteAddress },
  };
}

function createSocket(): FakeSocket {
  return {
    end: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn<(event: string, handler: () => void) => void>(),
  };
}

async function upgrade(options: UpgradeOptions = {}): Promise<FakeSocket> {
  const socket = createSocket();
  server.emit("upgrade", createRequest(options), socket, Buffer.alloc(0));
  await settle();
  return socket;
}

async function openChannel(
  options: UpgradeOptions = {},
): Promise<InstanceType<typeof hub.FakeChannel>> {
  await upgrade(options);
  const channel = hub.FakeServer.instances[0]?.channels.at(-1);
  if (!channel) throw new Error("No channel was opened.");
  return channel;
}

function installWith(settings: object = {}): void {
  server = createServer();
  installConversationWebChannel(server, {
    authenticator,
    conversations,
    createConnectionId: () => "connection-1",
    ...settings,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  hub.FakeServer.instances.length = 0;
  hub.FakeConnection.instances.length = 0;
  hub.FakePagesAuthenticator.instances.length = 0;
  hub.readSessionToken.mockResolvedValue(TOKEN);
  authenticator.isSessionActive.mockResolvedValue(true);
  installWith();
});

afterEach(() => {
  vi.useRealTimers();
});

function createIncoming(headers: Record<string, string>): IncomingMessage {
  const request = new IncomingMessage(new Socket());
  request.headers = headers;
  return request;
}

describe("admitConversationWebChannel", () => {
  const isForwardedHttps = vi.fn<(request: IncomingMessage) => boolean>();

  async function admit(
    headers: Record<string, string>,
  ): Promise<Awaited<ReturnType<typeof admitConversationWebChannel>>> {
    return admitConversationWebChannel(createIncoming(headers), {
      isForwardedHttps,
      authenticator,
    });
  }

  beforeEach(() => {
    isForwardedHttps.mockReturnValue(false);
  });

  it("returns the session token and the origin of the page", async () => {
    await expect(admit(createHeaders({}))).resolves.toEqual({
      sessionToken: TOKEN,
      origin: "http://pages.test",
    });
    expect(hub.readSessionToken).toHaveBeenCalledWith("sid=1");
    expect(authenticator.isSessionActive).toHaveBeenCalledWith(TOKEN);
  });

  it("builds a https origin behind a trusted proxy", async () => {
    isForwardedHttps.mockReturnValue(true);
    await expect(
      admit(createHeaders({ origin: "https://pages.test" })),
    ).resolves.toEqual({ sessionToken: TOKEN, origin: "https://pages.test" });
  });

  it.each([
    ["a foreign origin", { origin: "http://evil.test" }],
    ["a missing origin", { origin: "" }],
    ["a scheme that differs from the page", { origin: "https://pages.test" }],
  ])("refuses %s with 403", async (name, headers) => {
    await expect(admit(createHeaders(headers))).rejects.toMatchObject({
      name: "ChannelRefusal",
      status: 403,
    });
    expect(hub.readSessionToken).not.toHaveBeenCalled();
  });

  it("refuses a request without a host with 403", async () => {
    await expect(admit({ origin: "http://undefined" })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("reads a missing cookie as null and refuses without a session", async () => {
    hub.readSessionToken.mockResolvedValue(null);
    await expect(
      admit({ host: "pages.test", origin: "http://pages.test" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(hub.readSessionToken).toHaveBeenCalledWith(null);
    expect(authenticator.isSessionActive).not.toHaveBeenCalled();
  });

  it("refuses an ended session with 401", async () => {
    authenticator.isSessionActive.mockResolvedValue(false);
    await expect(admit(createHeaders({}))).rejects.toMatchObject({
      status: 401,
      message: "The conversation channel was refused with 401.",
    });
  });
});

describe("upgrade handling", () => {
  it("bounds the payload and disables compression", () => {
    expect(hub.FakeServer.instances[0]?.options).toMatchObject({
      noServer: true,
      perMessageDeflate: false,
    });
  });

  it("leaves upgrades of other paths untouched", async () => {
    const socket = await upgrade({ url: "/runner/v1/channel/x" });
    expect(socket.on).not.toHaveBeenCalled();
    expect(socket.end).not.toHaveBeenCalled();
    expect(hub.readSessionToken).not.toHaveBeenCalled();
  });

  it("opens a connection bound to the cookie session", async () => {
    await openChannel({
      remoteAddress: "10.0.0.7",
      headers: { "user-agent": "Browser/1.0" },
    });
    const connection = hub.FakeConnection.instances[0];
    expect(connection?.settings).toMatchObject({
      connectionId: "connection-1",
      origin: { clientAddress: "10.0.0.7", userAgent: "Browser/1.0" },
      conversations,
      answers: hub.answers,
      handshakeOrigin: "http://pages.test",
      serverVersion: PAGES_VERSION,
    });
    const web = connection?.settings.authenticator;
    expect(web).toBeInstanceOf(hub.FakeWebAuthenticator);
    expect(web).toMatchObject({ inner: authenticator, sessionToken: TOKEN });
    expect(connection?.start).toHaveBeenCalledOnce();
  });

  it("truncates a long user agent and reports an unknown peer as null", async () => {
    await openChannel({ headers: { "user-agent": "a".repeat(250) } });
    expect(hub.FakeConnection.instances[0]?.settings).toMatchObject({
      origin: { clientAddress: null, userAgent: "a".repeat(200) },
    });
  });

  it("reports a missing user agent as null", async () => {
    const socket = createSocket();
    const request = {
      url: "/chat/conversations/socket?x=1",
      headers: { host: "pages.test", origin: "http://pages.test" },
      socket: { remoteAddress: "10.0.0.7" },
    };
    server.emit("upgrade", request, socket, Buffer.alloc(0));
    await settle();
    expect(hub.FakeConnection.instances[0]?.settings).toMatchObject({
      origin: { clientAddress: "10.0.0.7", userAgent: null },
    });
  });

  it("accepts a https origin behind a trusted proxy", async () => {
    hub.FakeServer.instances.length = 0;
    installWith({ trustedProxies: ["10.0.0.7"] });
    await openChannel({
      remoteAddress: "10.0.0.7",
      headers: { origin: "https://pages.test", "x-forwarded-proto": "https" },
    });
    expect(hub.FakeConnection.instances[0]?.settings).toMatchObject({
      handshakeOrigin: "https://pages.test",
    });
  });

  it.each([
    ["a foreign origin", { origin: "http://evil.test" }, null, 403],
    ["a missing session", {}, null, 401],
    ["an ended session", {}, false, 401],
  ])("refuses %s without logging", async (name, headers, active, status) => {
    if (active === null) hub.readSessionToken.mockResolvedValue(null);
    else authenticator.isSessionActive.mockResolvedValue(active);
    const socket = await upgrade({ headers });
    expect(socket.end).toHaveBeenCalledWith(refusal(status));
    expect(hub.logCaughtError).not.toHaveBeenCalled();
    expect(hub.FakeConnection.instances).toHaveLength(0);
  });

  it("answers 503 and logs when the session check fails unexpectedly", async () => {
    const failure = new Error("database down");
    authenticator.isSessionActive.mockRejectedValue(failure);
    const socket = await upgrade();
    expect(socket.end).toHaveBeenCalledWith(refusal(503));
    expect(hub.logCaughtError).toHaveBeenCalledWith(
      "ConversationWebChannel",
      failure,
    );
  });

  it("answers 503 without logging once 500 channels are open", async () => {
    const instance = hub.FakeServer.instances[0];
    for (let index = 0; index < 500; index += 1)
      instance?.clients.add(new hub.FakeChannel());
    const socket = await upgrade();
    expect(socket.end).toHaveBeenCalledWith(refusal(503));
    expect(hub.logCaughtError).not.toHaveBeenCalled();
    expect(hub.readSessionToken).not.toHaveBeenCalled();
  });
});

describe("upgrade resilience", () => {
  it("destroys a socket that errors before the upgrade completes", async () => {
    const socket = await upgrade();
    const [event, handler] = socket.on.mock.calls[0] ?? [];
    expect(event).toBe("error");
    handler();
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it("destroys a socket whose admission takes longer than ten seconds", async () => {
    hub.readSessionToken.mockReturnValue(new Promise(() => undefined));
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

describe("connection wiring", () => {
  it("hands text, binary, pong, error and close events to the connection", async () => {
    const channel = await openChannel();
    const connection = hub.FakeConnection.instances[0];
    channel.emit("message", Buffer.from("héllo"), false);
    channel.emit("message", [Buffer.from("ab"), Buffer.from("cd")], false);
    channel.emit("message", new TextEncoder().encode("arr").buffer, false);
    channel.emit("message", Buffer.from([1, 2]), true);
    channel.emit("pong");
    const failure = new Error("socket reset");
    channel.emit("error", failure);
    channel.emit("close", 1001);
    expect(connection?.receiveText.mock.calls).toEqual([
      ["héllo"],
      ["abcd"],
      ["arr"],
    ]);
    expect(connection?.receiveBinary).toHaveBeenCalledOnce();
    expect(connection?.receivePong).toHaveBeenCalledOnce();
    expect(hub.logCaughtError).toHaveBeenCalledWith(
      "ConversationWebChannel",
      failure,
    );
    expect(connection?.stop).toHaveBeenCalledWith(1001);
  });

  it("terminates every channel and closes the server on shutdown", async () => {
    const channel = await openChannel();
    Object.assign(channel, { terminate: vi.fn() });
    hub.FakeServer.instances[0]?.clients.add(channel);
    const [task, options] = hub.registerShutdownTask.mock.calls[0] ?? [];
    expect(options).toEqual({ step: "conversation_web_channel" });
    await task?.();
    expect(hub.FakeServer.instances[0]?.close).toHaveBeenCalledOnce();
  });
});

describe("default collaborators", () => {
  it("builds the Pages authenticator, the mobile conversations and a random connection id", async () => {
    const created = { name: "mobile conversations" };
    hub.createMobileConversations.mockReturnValue(created);
    hub.FakeServer.instances.length = 0;
    server = createServer();
    installConversationWebChannel(server);
    const pagesAuthenticator = hub.FakePagesAuthenticator.instances[0];
    pagesAuthenticator?.isSessionActive.mockResolvedValue(true);
    await openChannel();
    const settings = hub.FakeConnection.instances[0]?.settings;
    expect(settings?.conversations).toBe(created);
    expect(settings?.connectionId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(pagesAuthenticator?.isSessionActive).toHaveBeenCalledWith(TOKEN);
  });

  it("resolves the authentication service of the application on demand", async () => {
    const authService = { name: "auth service" };
    hub.getApplicationServices.mockResolvedValue({ authService });
    hub.FakeServer.instances.length = 0;
    installConversationWebChannel(createServer());
    const resolve = hub.FakePagesAuthenticator.instances[0]?.resolveAuthService;
    await expect(resolve?.()).resolves.toBe(authService);
  });
});
