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
        const message: StoredChatMessage = {
          ...input,
          id: `message-${stored.length}`,
          createdAt: "today",
        };
        stored.push(message);
        return message;
      },
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
  expect(input?.instructions).toContain("BESTÄTIGEN tickets_set_title");
  expect(input?.instructions).not.toContain("pages-action");
  expect(input?.instructions).not.toContain("agents.delete");
  expect(input?.prompt).toContain("Alte Unterhaltung");
  expect(input?.prompt).not.toContain("SOUL-Kennung");
  expect(input).toMatchObject({
    userId: OWNER.id,
    actor: OWNER,
    sessionId: SESSION.id,
    message: "Lies PAGE-1",
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
