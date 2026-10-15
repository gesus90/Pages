import { vi } from "vitest";

import { ChatError } from "@/backend/error/ChatErrors";
import { AssistantRequestRegistry } from "@/backend/service/assistant/AssistantRequestRegistry";
import { ChatContextService } from "@/backend/service/chat/ChatContextService";
import { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";

import type { StoredChatContext } from "@/backend/database/repositories/chat/ChatContextRepository";
import type { StoredChatMessage } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { ChatSession } from "@/definition/Chat";
import type { User } from "@/definition/User";

export const OWNER: User = {
  id: "owner",
  username: "owner",
  displayName: "Owner",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
export const FIRST = "apfel-birne-kirsche-pflaume-traube";
export const SECOND = "eins-zwei-drei-vier-fuenf";
export const FOREIGN = "rot-gruen-blau-gelb-weiss";
export const SESSION: ChatSession = {
  id: FIRST,
  createdAt: "2026-10-15",
  lastMessageAt: "2026-10-15",
  preview: "",
};
export const ASSIGNMENT: ResolvedAgentAssignment = {
  model: "synthetic",
  reasoningEffort: null,
  connection: {
    id: "connection",
    name: "Synthetic",
    provider: "openai",
    isActive: true,
    hasApiKey: true,
    testModel: null,
    reasoningEffort: null,
    cliLoggedInAt: null,
    cliAccountLabel: null,
    updatedAt: "2026-10-15",
  },
};

/** Own-session repository boundary with an independently owned foreign session. */
export function deletionFixture(): {
  readonly service: ChatSessionService;
  readonly stored: Map<string, string>;
  readonly remove: ReturnType<
    typeof vi.fn<
      (userId: string, id: string) => Promise<readonly string[] | null>
    >
  >;
  readonly files: ReturnType<
    typeof vi.fn<(names: readonly string[]) => Promise<void>>
  >;
} {
  const stored = new Map([
    [FIRST, OWNER.id],
    [SECOND, OWNER.id],
    [FOREIGN, "someone-else"],
  ]);
  const remove = vi.fn(
    async (userId: string, id: string): Promise<readonly string[] | null> => {
      if (stored.get(id) !== userId) return null;
      stored.delete(id);
      return [`file-${id}`];
    },
  );
  const files = vi
    .fn<(names: readonly string[]) => Promise<void>>()
    .mockResolvedValue(undefined);
  const service = new ChatSessionService({
    sessions: {
      list: async (userId) =>
        [...stored]
          .filter(([, owner]) => owner === userId)
          .map(([id]) => ({ ...SESSION, id })),
      find: async (userId, id) =>
        stored.get(id) === userId ? { ...SESSION, id } : null,
      exists: async (id) => stored.has(id),
      create: async (userId, id) => {
        stored.set(id, userId);
      },
      messages: async () => [],
      remove,
    },
    attachments: { list: async () => [] },
    settings: {
      read: async () => ({
        attachmentLimitBytes: 1024,
        systemInstruction: null,
      }),
    },
    languages: { findByUserId: async () => null },
    files: { remove: files },
  });
  return { service, stored, remove, files };
}

/** Summarization provider and persistence doubles; no external work or transcript mutation. */
export class ContextFixture {
  public readonly messages: StoredChatMessage[] = Array.from(
    { length: 10 },
    (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Fact ${index} ${"context ".repeat(150)}`,
      createdAt: "2026-10-15",
    }),
  );
  public stored: StoredChatContext = {
    summary: null,
    throughId: null,
    revision: 0,
  };
  public readonly resolve = vi.fn(async () => ASSIGNMENT);
  public readonly run = vi.fn(
    async () => "Goals, decisions and pending tasks.",
  );
  public readonly find = vi.fn(async () => ({
    ...emptyModelCatalog(),
    models: [
      {
        id: "synthetic",
        name: "Synthetic",
        contextWindow: 128_000,
        promptPrice: null,
        completionPrice: null,
        isFree: false,
        reasoning: "none" as const,
        reasoningEfforts: [],
        defaultReasoningEffort: null,
      },
    ],
  }));
  public readonly save = vi.fn(
    async (
      userId: string,
      sessionId: string,
      replacement: {
        summary: string;
        throughId: string;
        expectedRevision: number;
        latestId: string;
      },
    ): Promise<boolean> => {
      if (userId !== OWNER.id || sessionId !== FIRST)
        throw new Error("Unexpected context owner");
      if (
        this.stored.revision !== replacement.expectedRevision ||
        this.messages.at(-1)?.id !== replacement.latestId
      )
        return false;
      this.stored = {
        summary: replacement.summary,
        throughId: replacement.throughId,
        revision: this.stored.revision + 1,
      };
      return true;
    },
  );
  public readonly requests = new AssistantRequestRegistry();
  public readonly service = new ChatContextService({
    sessions: {
      require: async (actor, id) => {
        if (actor.id !== OWNER.id || id !== FIRST)
          throw new ChatError("sessionMissing");
        return SESSION;
      },
    },
    contexts: { read: async () => ({ ...this.stored }), save: this.save },
    messages: { messages: async () => [...this.messages] },
    agents: { resolve: this.resolve },
    catalogs: { find: this.find },
    execution: { run: this.run },
    requests: this.requests,
  });
}
