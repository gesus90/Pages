import { expect, it, vi } from "vitest";

import { ChatService } from "@/backend/service/chat/ChatService";
import { AssistantRequestRegistry } from "@/backend/service/assistant/AssistantRequestRegistry";
import { chatFailure } from "@/app/lib/chat-response.server";
import { ChatError } from "@/backend/error/ChatErrors";

import { ASSIGNMENT, FIRST, OWNER, SESSION } from "./page48-chat-fixture";
import { picaToolCalls, picaWorld } from "./page83-pica-fixture";
import { responseChunks } from "../../agents/runtime/runtime-fixture";

import type { ChatServiceDependencies } from "@/backend/service/chat/ChatService";
import type { StoredChatMessage } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { ChatJob } from "@/definition/ChatJob";

function chatWorld(
  options: {
    readonly cli?: boolean;
    readonly actionText?: boolean;
    readonly fail?: boolean;
  } = {},
): {
  readonly chat: ChatService;
  readonly native: ReturnType<typeof picaWorld>;
  readonly api: ReturnType<
    typeof vi.fn<ReturnType<typeof picaWorld>["service"]["run"]>
  >;
  readonly stored: StoredChatMessage[];
  readonly dependencies: ChatServiceDependencies;
} {
  const native = picaWorld((_, call) =>
    call === 0 && !options.actionText
      ? picaToolCalls([{ tool: "tickets_read", input: { ticketId: "PAGE-1" } }])
      : responseChunks(
          options.actionText
            ? '```pages-action\n{"operation":"agents.delete","parameters":{}}\n```'
            : "Gelesen",
        ),
  );
  const api = vi.fn(native.service.run.bind(native.service));
  if (options.fail) api.mockRejectedValue(new ChatError("accessDenied"));
  const stored: StoredChatMessage[] = [];
  // Like the unique index of the database: one message per client message ID.
  const sentIds = new Map<string, StoredChatMessage>();
  const dependencies: ChatServiceDependencies = {
    mode: "native-api",
    api: { run: api },
    sessions: native.sessions,
    messages: {
      messages: async () => [
        {
          id: "history",
          role: "assistant",
          content: "Alte Unterhaltung",
          createdAt: "today",
        },
      ],
      append: async (userId, sessionId, input) => {
        if (userId !== OWNER.id || sessionId !== FIRST)
          throw new Error("Unexpected chat storage actor");
        const { clientMessageId, ...content } = input;
        if (clientMessageId && sentIds.has(clientMessageId))
          throw new ChatError("messageAlreadySent");
        const message: StoredChatMessage = {
          ...content,
          id: `message-${stored.length}`,
          createdAt: "today",
        };
        stored.push(message);
        if (clientMessageId) sentIds.set(clientMessageId, message);
        return message;
      },
      findByClientId: async (sessionId, clientMessageId) =>
        sessionId === FIRST ? (sentIds.get(clientMessageId) ?? null) : null,
    },
    attachments: {
      pending: async () => [],
      link: async () => undefined,
      readText: async () => "",
    },
    protectedInstructions: async () => ({
      soul: "SOUL-Kennung",
      agents: "AGENTS-Kennung",
    }),
    settings: { instruction: async () => "Ergänzung" },
    agents: {
      resolve: async () => ({
        ...ASSIGNMENT,
        connection: {
          ...ASSIGNMENT.connection,
          provider: options.cli ? "codex_cli" : "openai",
        },
      }),
    },
    requests: new AssistantRequestRegistry(),
    languages: { findByUserId: async () => null },
  };
  return {
    chat: new ChatService(dependencies),
    native,
    api,
    stored,
    dependencies,
  };
}

it("runs one native turn and retains Pages-owned transcript and protected identity without legacy instructions", async () => {
  const world = chatWorld();
  const reply = await world.chat.send(OWNER, {
    requestId: "native",
    sessionId: FIRST,
    text: "Lies PAGE-1",
  });
  expect(reply.answer.content).toBe("Gelesen");
  expect(world.api).toHaveBeenCalledOnce();
  expect(world.native.router).toHaveBeenCalledOnce();
  expect(world.stored.map(({ role }) => role)).toEqual(["user", "assistant"]);
  const input = world.api.mock.calls[0]?.[0];
  expect(input?.instructions).toMatch(/^SOUL-Kennung\n\nAGENTS-Kennung/u);
  expect(input?.instructions).toContain("kein Bestätigungswort");
  expect(input?.instructions).not.toContain("BESTÄTIGEN");
  expect(input?.instructions).not.toContain("pages-action");
  expect(input?.instructions).not.toContain("agents.delete");
  expect(input?.prompt).toContain("Alte Unterhaltung");
  expect(input?.prompt).not.toContain("SOUL-Kennung");
  expect(input).toMatchObject({
    userId: OWNER.id,
    actor: OWNER,
    sessionId: SESSION.id,
  });
});

it("does not interpret native text as a legacy mutation or fall back after native failure", async () => {
  const text = chatWorld({ actionText: true });
  await text.chat.send(OWNER, {
    requestId: "text-action",
    sessionId: FIRST,
    text: "LÖSCHEN",
  });
  expect(text.api).toHaveBeenCalledOnce();
  expect(text.native.router).not.toHaveBeenCalled();
  expect(text.native.provider.calls).toHaveBeenCalledOnce();
  const failed = chatWorld({ fail: true });
  await expect(
    failed.chat.send(OWNER, {
      requestId: "failed",
      sessionId: FIRST,
      text: "Hallo",
    }),
  ).rejects.toMatchObject({ code: "accessDenied" });
  expect(failed.api).toHaveBeenCalledOnce();
  expect(failed.stored.map(({ role }) => role)).toEqual(["user"]);
});

it("rejects ACP before storing or executing a turn and returns a translatable browser error", async () => {
  const world = chatWorld({ cli: true });
  await expect(
    world.chat.send(OWNER, {
      requestId: "cli",
      sessionId: FIRST,
      text: "Hallo",
    }),
  ).rejects.toMatchObject({ code: "apiModeRequired" });
  expect(world.stored).toEqual([]);
  expect(world.api).not.toHaveBeenCalled();
  expect(world.native.provider.calls).not.toHaveBeenCalled();
  const response = chatFailure(new ChatError("apiModeRequired"));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    ok: false,
    error: "apiModeRequired",
  });
});

it("keeps legacy compatibility explicit and never calls native execution in that mode", async () => {
  const world = chatWorld();
  const execution = { run: vi.fn(async () => "Legacy answer") };
  const tools = { run: vi.fn(async () => ({ ok: false })) };
  const chat = new ChatService({
    ...world.dependencies,
    mode: "legacy-actions",
    execution,
    tools,
  });
  const reply = await chat.send(OWNER, {
    requestId: "legacy",
    sessionId: FIRST,
    text: "Hallo",
  });
  expect(reply.answer.content).toBe("Legacy answer");
  expect(execution.run).toHaveBeenCalledOnce();
  expect(world.api).not.toHaveBeenCalled();
});

it("stores a message sent again with the same client message ID only once", async () => {
  const world = chatWorld();
  const message = {
    requestId: "first-attempt",
    clientMessageId: "message-from-browser",
    sessionId: FIRST,
    text: "Lies PAGE-1",
  };
  const sent = await world.chat.submit(OWNER, message);
  expect(sent.kind).toBe("reply");
  await expect(
    world.chat.submit(OWNER, { ...message, requestId: "second-attempt" }),
  ).rejects.toMatchObject({ code: "messageAlreadySent" });
  expect(world.stored.map(({ role }) => role)).toEqual(["user", "assistant"]);
  expect(world.api).toHaveBeenCalledOnce();
  const response = chatFailure(new ChatError("messageAlreadySent"));
  expect(response.status).toBe(409);
});

it("answers a Codex message sent again with its job instead of steering or starting anew", async () => {
  const world = chatWorld({ cli: true });
  const job: ChatJob = {
    id: "00000000-0000-4000-8000-000000000068",
    sessionId: FIRST,
    state: "running",
    errorCode: null,
    createdAt: "today",
    endedAt: null,
    usage: { context: null, tokens: null, cost: null },
  };
  const first = await world.dependencies.messages.append(OWNER.id, FIRST, {
    role: "user",
    content: "Schreibe eine lange Liste",
    clientMessageId: "codex-message",
  });
  const acp = {
    steer: vi.fn(async () => null),
    start: vi.fn(async () => ({ job, messageId: "other" })),
    outcome: vi.fn(async () => ({
      kind: "job" as const,
      job: { job, messageId: first.id },
    })),
  };
  const chat = new ChatService({
    ...world.dependencies,
    mode: "native-api",
    api: { run: world.api },
    acp,
  });
  const sent = await chat.submit(OWNER, {
    requestId: "retry",
    clientMessageId: "codex-message",
    sessionId: FIRST,
    text: "Schreibe eine lange Liste",
  });
  expect(sent).toEqual({ kind: "job", job: { job, messageId: first.id } });
  expect(acp.outcome).toHaveBeenCalledWith(OWNER.id, FIRST, first.id);
  expect(acp.steer).not.toHaveBeenCalled();
  expect(acp.start).not.toHaveBeenCalled();
  expect(world.stored).toHaveLength(1);
});
