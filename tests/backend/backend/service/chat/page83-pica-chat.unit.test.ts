import { expect, it, vi } from "vitest";

import { ChatService } from "@/backend/service/chat/ChatService";
import { ChatRequestRegistry } from "@/backend/service/chat/ChatRequestRegistry";
import { ChatError } from "@/backend/error/ChatErrors";

import { ASSIGNMENT, FIRST, OWNER, SESSION } from "./page48-chat-fixture";

import type { ChatServiceDependencies } from "@/backend/service/chat/ChatService";
import type { PicaAcpService } from "@/backend/service/chat/acp/PicaAcpService";
import type { AgentProviderId } from "@/definition/AgentConnection";

function chatWorld(provider: AgentProviderId = "opencode"): {
  readonly chat: ChatService;
  readonly dependencies: ChatServiceDependencies;
  readonly acp: {
    readonly start: ReturnType<typeof vi.fn<PicaAcpService["start"]>>;
    readonly steer: ReturnType<typeof vi.fn<PicaAcpService["steer"]>>;
    readonly outcome: ReturnType<typeof vi.fn<PicaAcpService["outcome"]>>;
  };
  readonly append: ReturnType<typeof vi.fn>;
} {
  const acp = {
    start: vi.fn<PicaAcpService["start"]>(),
    steer: vi.fn<PicaAcpService["steer"]>(async () => null),
    outcome: vi.fn<PicaAcpService["outcome"]>(async () => null),
  };
  const append = vi.fn();
  const dependencies: ChatServiceDependencies = {
    mode: "acp",
    acp,
    sessions: { require: async () => SESSION },
    messages: {
      messages: async () => [
        {
          id: "history",
          role: "assistant",
          content: "Alte Unterhaltung",
          createdAt: "today",
        },
      ],
      append,
      findByClientId: async () => null,
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
        connection: { ...ASSIGNMENT.connection, provider },
      }),
    },
    requests: new ChatRequestRegistry(),
    languages: { findByUserId: async () => null },
  };
  return { chat: new ChatService(dependencies), dependencies, acp, append };
}

const MESSAGE = {
  requestId: "request",
  clientMessageId: "client-message",
  sessionId: FIRST,
  text: "Lies PAGE-1",
};

it.each(["codex_cli", "claude_code", "opencode"] as const)(
  "submits %s exclusively through ACP with protected identity and retained history",
  async (provider) => {
    const world = chatWorld(provider);
    await world.chat.submit(OWNER, MESSAGE);
    expect(world.acp.start).toHaveBeenCalledOnce();
    const input = world.acp.start.mock.calls[0]?.[0];
    expect(input?.agent.connection.provider).toBe(provider);
    expect(input?.brief.instructions).toMatch(
      /^SOUL-Kennung\n\nAGENTS-Kennung/u,
    );
    expect(input?.brief.instructions).not.toContain("pages-action");
    expect(input?.brief.prompt.history[0]?.content).toBe("Alte Unterhaltung");
    expect(world.append).not.toHaveBeenCalled();
  },
);

it("does not fall back after ACP failure, without an ACP service, or for an API-only selection", async () => {
  const world = chatWorld();
  world.acp.start.mockRejectedValueOnce(new ChatError("accessDenied"));
  await expect(world.chat.submit(OWNER, MESSAGE)).rejects.toMatchObject({
    code: "accessDenied",
  });
  await expect(
    new ChatService({
      ...world.dependencies,
      mode: "acp",
      acp: undefined,
    }).submit(OWNER, MESSAGE),
  ).rejects.toMatchObject({ code: "acpProviderUnsupported" });
  const api = chatWorld("openai");
  await expect(api.chat.submit(OWNER, MESSAGE)).rejects.toMatchObject({
    code: "acpProviderUnsupported",
  });
  expect(api.acp.start).not.toHaveBeenCalled();
  expect(api.append).not.toHaveBeenCalled();
});

it("refuses synchronous sends in production before storing a message", async () => {
  const world = chatWorld();
  await expect(world.chat.send(OWNER, MESSAGE)).rejects.toMatchObject({
    code: "acpProviderUnsupported",
  });
  expect(world.append).not.toHaveBeenCalled();
  expect(world.acp.start).not.toHaveBeenCalled();
});

it("answers a repeated client message with its existing outcome without steering or starting again", async () => {
  const world = chatWorld();
  const steer = {
    messageId: "stored",
    jobId: "job",
    status: "pending" as const,
  };
  world.dependencies.messages.findByClientId = async () => ({
    id: "stored",
    role: "user",
    content: MESSAGE.text,
    createdAt: "today",
  });
  world.acp.outcome.mockResolvedValue({ kind: "steer", steer });
  expect(await world.chat.submit(OWNER, MESSAGE)).toEqual({
    kind: "steer",
    steer,
  });
  expect(world.acp.outcome).toHaveBeenCalledWith(OWNER.id, FIRST, "stored");
  expect(world.acp.start).not.toHaveBeenCalled();
  expect(world.acp.steer).not.toHaveBeenCalled();
});

it("joins the pinned running job without changing its model", async () => {
  const world = chatWorld();
  const steer = {
    messageId: "stored",
    jobId: "job",
    status: "pending" as const,
  };
  world.acp.steer.mockResolvedValue(steer);
  expect(await world.chat.submit(OWNER, MESSAGE)).toEqual({
    kind: "steer",
    steer,
  });
  expect(world.acp.start).not.toHaveBeenCalled();
});
