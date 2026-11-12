import { afterEach, describe, expect, it, vi } from "vitest";

import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { ChatContactRepository } from "@/backend/database/repositories/employee/ChatContactRepository";
import { ChatGroupRepository } from "@/backend/database/repositories/employee/ChatGroupRepository";
import { AccountIdentityRepository } from "@/backend/database/repositories/employee/AccountIdentityRepository";
import { AgentConversationRepository } from "@/backend/database/repositories/employee/AgentConversationRepository";
import { AgentEmployeeRepository } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import { AgentChatMemoryRepository } from "@/backend/database/repositories/employee/AgentChatMemoryRepository";
import { ConversationError } from "@/backend/error/ConversationError";
import { ChatDirectoryService } from "@/backend/service/employee/ChatDirectoryService";

import type { Mock } from "vitest";
import type { Database } from "@/backend/database/Database";
import type { User } from "@/definition/User";

const person: User = {
  id: "person",
  username: "person",
  displayName: "Person",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const human: User = {
  ...person,
  id: "human",
  username: "human",
  displayName: "Human",
};
const agent: User = {
  ...person,
  id: "agent",
  username: "agent",
  displayName: "Agent",
  isAgent: true,
};
const inactive: User = { ...human, id: "inactive", isActive: false };

function setup(): {
  service: ChatDirectoryService;
  replace: Mock;
  history: Mock;
  oversightHistory: Mock;
} {
  const database: Pick<Database, "query" | "execute" | "transaction"> = {
    query: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  };
  vi.spyOn(ChatContactRepository.prototype, "list").mockResolvedValue([
    { contactId: "agent", lastActivityAt: "2026-01-01" },
    { contactId: "inactive", lastActivityAt: "2026-01-01" },
    { contactId: "missing", lastActivityAt: "2026-01-01" },
  ]);
  const replace = vi
    .spyOn(ChatContactRepository.prototype, "replace")
    .mockResolvedValue();
  vi.spyOn(ChatGroupRepository.prototype, "list").mockResolvedValue([]);
  vi.spyOn(AccountIdentityRepository.prototype, "jobTitles").mockResolvedValue(
    new Map([["agent", "Writer"]]),
  );
  vi.spyOn(AgentConversationRepository.prototype, "find").mockResolvedValue(
    null,
  );
  vi.spyOn(AgentEmployeeRepository.prototype, "find").mockResolvedValue(null);
  vi.spyOn(
    AgentChatMemoryRepository.prototype,
    "confidentialAgents",
  ).mockResolvedValue(new Set(["agent"]));
  vi.spyOn(
    AgentChatMemoryRepository.prototype,
    "confidentialConversations",
  ).mockResolvedValue(new Set());
  const history = vi.fn();
  const oversightHistory = vi.fn();
  const service = new ChatDirectoryService({
    store: new EmployeeStore(database),
    users: {
      findAll: vi.fn().mockResolvedValue([person, human, agent, inactive]),
    },
    lookups: {
      listActiveUsers: vi.fn().mockResolvedValue([person, human, agent]),
    },
    messages: { messages: vi.fn().mockResolvedValue([]) },
    conversations: { views: vi.fn().mockResolvedValue([]), history },
    oversight: {
      views: vi.fn().mockResolvedValue([]),
      history: oversightHistory,
    },
    isWorking: vi.fn().mockResolvedValue(false),
    queuedAgentMessages: () => [{ id: "q", text: "queued" }],
    now: () => new Date("2026-02-01T00:00:00.000Z"),
  });
  return { service, replace, history, oversightHistory };
}

afterEach(() => vi.restoreAllMocks());

describe("ChatDirectoryService", () => {
  it("shows existing contacts, queue state and eligible choices", async () => {
    const { service } = setup();
    const result = await service.directory(person);

    expect(result.participants).toHaveLength(2);
    expect(result.participants[0]).toMatchObject({
      id: "agent",
      role: "Writer",
      status: "working",
      canChat: true,
      isConfidential: true,
    });
    expect(result.participants[1]).toMatchObject({
      id: "inactive",
      status: "off",
      canChat: false,
    });
    expect(result.histories.agent).toEqual([
      {
        id: "queued-q",
        authorId: null,
        content: "queued",
        toolUses: [],
        queue: "limit",
      },
    ]);
    expect(result.contactChoices.map((choice) => choice.id)).toEqual([
      "human",
      "agent",
    ]);
    expect(result.groups).toEqual([]);
  });

  it("deduplicates additions and preserves existing inactive contacts", async () => {
    const { service, replace } = setup();
    await service.saveContacts(person, ["inactive", "human", "agent", "human"]);
    expect(replace).toHaveBeenCalledWith(
      "person",
      new Map([["human", "2026-02-01T00:00:00.000Z"]]),
      ["inactive", "agent"],
    );
  });

  it.each([
    null,
    ["person"],
    ["unknown"],
    [123],
    Array.from({ length: 501 }, () => "human"),
  ])("rejects invalid contact input without writes", async (input) => {
    const { service, replace } = setup();
    await expect(service.saveContacts(person, input)).rejects.toMatchObject({
      code: "invalidInput",
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("falls back to oversight only for an inaccessible conversation", async () => {
    const { service, history, oversightHistory } = setup();
    history.mockRejectedValue(new ConversationError("not_found"));
    oversightHistory.mockResolvedValue({
      conversationId: "c",
      messages: [],
      hasMore: true,
    });
    await expect(
      service.olderMessages(person, { conversationId: "c", beforeId: "m" }),
    ).resolves.toEqual({ conversationId: "c", messages: [], hasMore: true });
    expect(history).toHaveBeenCalledWith(person, "c", "m", {
      withDecisions: true,
    });
    expect(oversightHistory).toHaveBeenCalledWith(person, "c", "m");
    history.mockRejectedValue(new ConversationError("invalid"));
    await expect(
      service.olderMessages(person, { conversationId: "c", beforeId: "m" }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      service.olderMessages(person, { conversationId: 1, beforeId: "m" }),
    ).rejects.toMatchObject({ code: "invalid" });
  });
});
