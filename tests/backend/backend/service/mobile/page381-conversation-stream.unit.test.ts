import { expect, it, vi } from "vitest";

import { readPicaMobileCapabilities } from "@/backend/service/mobile/PicaMobileCapabilities";
import { PicaMobileWebAuthenticator } from "@/backend/service/mobile/PicaMobileWebAuthenticator";
import { PagesPicaMobileConversations } from "@/backend/service/mobile/conversations/PagesPicaMobileConversations";
import { PicaMobileConversationsHandler } from "@/backend/service/mobile/conversations/PicaMobileConversationsHandler";
import { PICA_MOBILE_CAPABILITY } from "@/definition/PicaMobileProtocol";

import type { ConversationEvent } from "@/backend/service/conversation/ConversationEvents";
import type { PicaMobileAuthenticator } from "@/backend/service/mobile/PicaMobileAuthenticator";
import type { PicaMobileConversationsProvider } from "@/backend/service/mobile/conversations/PicaMobileConversationsProvider";
import type { PicaMobilePlansHost } from "@/backend/service/mobile/plans/PicaMobilePlansHandler";
import type { LiveAnswerSnapshot } from "@/definition/ConversationLiveAnswer";

const SESSION = { userId: "igor", sessionToken: "token" };

const TEXT_EVENT: ConversationEvent = {
  kind: "answer",
  recipientIds: ["igor"],
  payload: {
    type: "answer_text",
    data: {
      chatKind: "agent",
      chatId: "ed",
      agentId: "ed",
      answerId: "a1",
      seq: 1,
      at: "2026-11-14T10:00:00.000Z",
      delta: "Hallo",
      isReset: false,
    },
  },
};

const MESSAGE_EVENT: ConversationEvent = {
  kind: "message",
  recipientIds: ["igor"],
  message: {
    id: "m1",
    conversationId: "team",
    clientMessageId: "c1",
    sender: { id: "anna", kind: "human", name: "Anna", color: null },
    text: "Hallo",
    createdAt: "2026-11-14T10:00:00.000Z",
    mentions: [],
    attachments: [],
    links: [],
  },
};

const SNAPSHOT: LiveAnswerSnapshot = {
  chatKind: "conversation",
  chatId: "team",
  agentId: "ed",
  answerId: "a0",
  seq: 4,
  at: "2026-11-14T10:00:00.000Z",
  startedAt: "2026-11-14T09:59:00.000Z",
  text: "Bis hierher",
  thought: null,
  tools: [],
  end: null,
};

function host(): PicaMobilePlansHost & { readonly frames: unknown[] } {
  const frames: unknown[] = [];
  const queue: (() => Promise<void>)[] = [];
  let isRunning = false;
  async function drain(): Promise<void> {
    if (isRunning) return;
    isRunning = true;
    while (queue.length > 0) await queue.shift()?.();
    isRunning = false;
  }
  return {
    frames,
    session: () => SESSION,
    isOpen: () => true,
    send: (frame) => frames.push(JSON.parse(frame)),
    reject: vi.fn(),
    rejectUnauthenticated: vi.fn(),
    acknowledge: vi.fn(),
    endSession: vi.fn(),
    reportFailure: vi.fn(),
    enqueue: (task) => {
      queue.push(task);
      void drain();
    },
  };
}

function provider(): {
  readonly provider: PicaMobileConversationsProvider;
  emit(event: ConversationEvent): void;
} {
  let listener: ((event: ConversationEvent) => void) | null = null;
  const pages = new PagesPicaMobileConversations({
    resolveServices: vi.fn(),
    events: { subscribe: vi.fn() },
  });
  return {
    provider: {
      answer: vi.fn(),
      beginVoice: vi.fn(),
      openVoice: vi.fn(),
      describe: (session, event) => pages.describe(session, event),
      follow: (next) => {
        listener = next;
        return () => {
          listener = null;
        };
      },
    },
    emit: (event) => listener?.(event),
  };
}

it("never sends the parts of live answers to Pica Mobile, whose other events go on as before", async () => {
  const connection = host();
  const { provider: conversations, emit } = provider();
  const handler = new PicaMobileConversationsHandler(conversations, connection, {
    connectionId: "mobile",
    presence: { set: vi.fn() },
  });
  handler.start();
  emit(TEXT_EVENT);
  emit(MESSAGE_EVENT);
  await vi.waitFor(() => expect(connection.frames).toHaveLength(1));
  expect(connection.frames[0]).toMatchObject({
    type: "conversation_event",
    payload: { type: "message", data: { id: "m1" } },
  });
});

it("sends the browser a snapshot of running answers and then their parts", async () => {
  const connection = host();
  const { provider: conversations, emit } = provider();
  const snapshots = vi.fn().mockReturnValue([SNAPSHOT]);
  const handler = new PicaMobileConversationsHandler(conversations, connection, {
    connectionId: "web",
    presence: { set: vi.fn() },
    answers: { snapshots },
  });
  handler.start();
  emit(TEXT_EVENT);
  emit({ ...TEXT_EVENT, recipientIds: ["anna"] });
  await vi.waitFor(() => expect(connection.frames).toHaveLength(2));
  expect(snapshots).toHaveBeenCalledWith("igor");
  expect(connection.frames).toEqual([
    expect.objectContaining({
      requestId: null,
      type: "conversation_event",
      payload: { type: "answer_snapshot", data: SNAPSHOT },
    }),
    expect.objectContaining({
      payload: expect.objectContaining({ type: "answer_text" }),
    }),
  ]);
});

it("announces conversations.stream.v1 only for the browser's connection", async () => {
  const session = { userId: "igor", sessionToken: "token" };
  const conversations = provider().provider;
  const mobile = await readPicaMobileCapabilities({ conversations }, session);
  expect(mobile).toContain(PICA_MOBILE_CAPABILITY.CONVERSATIONS_V1);
  expect(mobile).not.toContain(PICA_MOBILE_CAPABILITY.CONVERSATIONS_STREAM_V1);
  const web = await readPicaMobileCapabilities(
    { conversations, answers: { snapshots: vi.fn() } },
    session,
  );
  expect(web).toContain(PICA_MOBILE_CAPABILITY.CONVERSATIONS_STREAM_V1);
});

it("authenticates the browser with the session of its cookie and refuses a password", async () => {
  const inner: PicaMobileAuthenticator = {
    authenticate: vi.fn().mockResolvedValue({
      ok: true,
      user: { id: "igor", username: "igor", displayName: "Igor" },
      sessionToken: "cookie-token",
      isSessionIssued: false,
    }),
    isSessionActive: vi.fn().mockResolvedValue(true),
  };
  const web = new PicaMobileWebAuthenticator(inner, "cookie-token");
  const origin = { clientAddress: null, userAgent: null };
  await expect(
    web.authenticate({ method: "session", token: "cookie" }, origin),
  ).resolves.toMatchObject({ ok: true, isSessionIssued: false });
  expect(inner.authenticate).toHaveBeenCalledWith(
    { method: "session", token: "cookie-token" },
    origin,
  );
  await expect(
    web.authenticate(
      { method: "password", username: "igor", password: "x" },
      origin,
    ),
  ).resolves.toEqual({ ok: false, reason: "invalidCredentials" });
  await expect(web.isSessionActive("cookie-token")).resolves.toBe(true);
});
