import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";

import { beforeEach, expect, it, vi } from "vitest";

import { browserSessionCookie } from "@/backend/auth/BrowserSessionCookie";
import { isConversationWebChannel } from "@/backend/runtime/ChannelPaths";
import {
  admitConversationWebChannel,
  installConversationWebChannel,
} from "@/backend/runtime/ConversationWebChannel";

import type { IncomingMessage } from "node:http";
import type { PicaMobileAuthenticator } from "@/backend/service/mobile/PicaMobileAuthenticator";

const mocks = vi.hoisted(() => ({ upgrade: vi.fn(), register: vi.fn() }));

vi.mock("ws", () => ({
  WebSocketServer: class {
    public clients = new Set();
    public handleUpgrade = mocks.upgrade;
    public close = vi.fn();
  },
}));
vi.mock("@/backend/runtime/ProcessLifecycle", () => ({
  registerShutdownTask: mocks.register,
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

function request(headers: Record<string, string>): IncomingMessage {
  const message = new EventEmitter() as IncomingMessage;
  Object.assign(message, {
    url: "/chat/conversations/socket",
    headers,
    socket: { remoteAddress: "127.0.0.1" },
  });
  return message;
}

function authenticator(isActive: boolean): PicaMobileAuthenticator {
  return {
    authenticate: vi.fn().mockResolvedValue({
      ok: true,
      user: { id: "igor", username: "igor", displayName: "Igor" },
      sessionToken: "secret-token",
      isSessionIssued: false,
    }),
    isSessionActive: vi.fn().mockResolvedValue(isActive),
  };
}

const context = (
  isActive = true,
): Parameters<typeof admitConversationWebChannel>[1] => ({
  isForwardedHttps: () => false,
  authenticator: authenticator(isActive),
});

beforeEach(() => vi.clearAllMocks());

it("knows the path of the chat page's channel and nothing else", () => {
  expect(isConversationWebChannel("/chat/conversations/socket")).toBe(true);
  expect(isConversationWebChannel("/chat/conversations/socket?x=1")).toBe(true);
  expect(isConversationWebChannel("/runner/v1/channel/abc")).toBe(false);
  expect(isConversationWebChannel("http://[bad")).toBe(false);
});

it("admits the browser's own origin with a session that holds", async () => {
  const cookie = await browserSessionCookie.serialize("secret-token");
  const admission = await admitConversationWebChannel(
    request({ host: "pages.test", origin: "http://pages.test", cookie }),
    context(),
  );
  expect(admission).toEqual({
    sessionToken: "secret-token",
    origin: "http://pages.test",
  });
});

it("refuses a foreign origin, a missing session and an ended one", async () => {
  const cookie = await browserSessionCookie.serialize("secret-token");
  await expect(
    admitConversationWebChannel(
      request({ host: "pages.test", origin: "https://evil.test", cookie }),
      context(),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    admitConversationWebChannel(
      request({ host: "pages.test", origin: "http://pages.test" }),
      context(),
    ),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    admitConversationWebChannel(
      request({ host: "pages.test", origin: "http://pages.test", cookie }),
      context(false),
    ),
  ).rejects.toMatchObject({ status: 401 });
});

it("answers only its own path and refuses an upgrade without a session", async () => {
  const server = createServer();
  installConversationWebChannel(server, {
    authenticator: authenticator(true),
    conversations: {
      answer: vi.fn(),
      beginVoice: vi.fn(),
      openVoice: vi.fn(),
      describe: vi.fn(),
      follow: vi.fn().mockReturnValue(vi.fn()),
    },
  });
  const other = new PassThrough();
  const otherEnd = vi.spyOn(other, "end");
  server.emit(
    "upgrade",
    Object.assign(request({ host: "pages.test" }), { url: "/elsewhere" }),
    other,
    Buffer.alloc(0),
  );
  const socket = new PassThrough();
  const end = vi.spyOn(socket, "end");
  server.emit(
    "upgrade",
    request({ host: "pages.test", origin: "http://pages.test" }),
    socket,
    Buffer.alloc(0),
  );
  await vi.waitFor(() =>
    expect(end).toHaveBeenCalledWith(expect.stringContaining("401")),
  );
  expect(otherEnd).not.toHaveBeenCalled();
  expect(mocks.upgrade).not.toHaveBeenCalled();
});

it("opens a conversations.v1 connection for the signed-in browser", async () => {
  const server = createServer();
  const channel = Object.assign(new EventEmitter(), {
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    ping: vi.fn(),
  });
  mocks.upgrade.mockImplementation(
    (
      ...[, , , callback]: [
        unknown,
        unknown,
        unknown,
        (opened: EventEmitter) => void,
      ]
    ) => callback(channel),
  );
  const auth = authenticator(true);
  installConversationWebChannel(server, {
    authenticator: auth,
    conversations: {
      answer: vi.fn(),
      beginVoice: vi.fn(),
      openVoice: vi.fn(),
      describe: vi.fn(),
      follow: vi.fn().mockReturnValue(vi.fn()),
    },
    createConnectionId: () => "web-1",
  });
  const cookie = await browserSessionCookie.serialize("secret-token");
  server.emit(
    "upgrade",
    request({ host: "pages.test", origin: "http://pages.test", cookie }),
    new PassThrough(),
    Buffer.alloc(0),
  );
  await vi.waitFor(() => expect(mocks.upgrade).toHaveBeenCalled());
  channel.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        version: 1,
        type: "auth",
        requestId: "web-auth",
        payload: { method: "session", token: "cookie" },
      }),
    ),
    false,
  );
  await vi.waitFor(() => expect(channel.send).toHaveBeenCalled());
  const connected: unknown = JSON.parse(
    String(channel.send.mock.calls[0]?.[0]),
  );
  expect(connected).toMatchObject({
    type: "connected",
    payload: {
      sessionToken: null,
      server: {
        capabilities: ["conversations.v1", "conversations.stream.v1"],
      },
    },
  });
  expect(auth.authenticate).toHaveBeenCalledWith(
    { method: "session", token: "secret-token" },
    expect.anything(),
  );
  channel.emit("close", 1000);
});
