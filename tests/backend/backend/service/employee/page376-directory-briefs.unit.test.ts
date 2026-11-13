import { afterEach, expect, it, vi } from "vitest";

import { AccountIdentityRepository } from "@/backend/database/repositories/employee/AccountIdentityRepository";
import { AgentChatMemoryRepository } from "@/backend/database/repositories/employee/AgentChatMemoryRepository";
import { AgentConversationRepository } from "@/backend/database/repositories/employee/AgentConversationRepository";
import { AgentEmployeeRepository } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import { ChatContactRepository } from "@/backend/database/repositories/employee/ChatContactRepository";
import { ChatGroupRepository } from "@/backend/database/repositories/employee/ChatGroupRepository";
import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { ChatDirectoryService } from "@/backend/service/employee/ChatDirectoryService";

import type { Database } from "@/backend/database/Database";
import type { AgentChatSessionBrief } from "@/definition/AgentChatSession";
import type { User } from "@/definition/User";

const person: User = {
  id: "person",
  username: "person",
  displayName: "Person",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const agent: User = {
  ...person,
  id: "agent",
  username: "agent",
  displayName: "Ed",
  isAgent: true,
};

const DIRECT: AgentChatSessionBrief = {
  sessionId: "s-direct",
  agentId: "agent",
  state: "ready",
  contextPercent: 34,
  waitingMessages: 0,
};
const GROUP: AgentChatSessionBrief = {
  sessionId: "s-group",
  agentId: "agent",
  state: "working",
  contextPercent: 58,
  waitingMessages: 2,
};

afterEach(() => vi.restoreAllMocks());

it("gives the head of a chat the session of each agent in it", async () => {
  const database: Pick<Database, "query" | "execute" | "transaction"> = {
    query: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  };
  vi.spyOn(ChatContactRepository.prototype, "list").mockResolvedValue([
    { contactId: "agent", lastActivityAt: "2026-01-01" },
  ]);
  vi.spyOn(ChatGroupRepository.prototype, "list").mockResolvedValue([
    {
      id: "group-1",
      name: "Pages Team",
      description: "",
      memberIds: ["agent"],
      lastActivityAt: "2026-01-01",
    },
  ]);
  vi.spyOn(AccountIdentityRepository.prototype, "jobTitles").mockResolvedValue(
    new Map(),
  );
  vi.spyOn(AgentConversationRepository.prototype, "find").mockResolvedValue({
    sessionId: "s-direct",
    agentId: "agent",
    personId: "person",
    purpose: "chat",
  });
  vi.spyOn(AgentEmployeeRepository.prototype, "find").mockResolvedValue(null);
  vi.spyOn(
    AgentChatMemoryRepository.prototype,
    "confidentialAgents",
  ).mockResolvedValue(new Set());
  vi.spyOn(
    AgentChatMemoryRepository.prototype,
    "confidentialConversations",
  ).mockResolvedValue(new Set());
  const directBrief = vi.fn(async () => DIRECT);
  const groupBriefs = vi.fn(
    async (id: string, signals: (agentId: string) => unknown) => {
      expect(signals("agent")).toEqual({ isWorking: true, waitingMessages: 2 });
      return [GROUP];
    },
  );
  const service = new ChatDirectoryService({
    store: new EmployeeStore(database),
    users: { findAll: vi.fn().mockResolvedValue([person, agent]) },
    lookups: { listActiveUsers: vi.fn().mockResolvedValue([person, agent]) },
    messages: { messages: vi.fn().mockResolvedValue([]) },
    conversations: { views: vi.fn().mockResolvedValue([]), history: vi.fn() },
    isWorking: vi.fn().mockResolvedValue(true),
    waitingInJob: vi.fn().mockResolvedValue(new Set(["m1"])),
    workingAgentIds: () => ["agent"],
    queuedFor: () => 2,
    agentSessions: { directBrief, groupBriefs },
  });
  const directory = await service.directory(person);
  expect(directory.participants[0]?.session).toEqual(DIRECT);
  // The waiting messages of the direct chat are the ones its running job holds back.
  expect(directBrief).toHaveBeenCalledWith("agent", "person", {
    isWorking: true,
    waitingMessages: 1,
  });
  expect(directory.groups[0]?.agentSessions).toEqual([GROUP]);
  expect(groupBriefs).toHaveBeenCalledWith("group-1", expect.any(Function));
});

it('names the reply mode of each group for the entry "Wer antwortet?" of the group menu (PAGE-379)', async () => {
  const database: Pick<Database, "query" | "execute" | "transaction"> = {
    query: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  };
  vi.spyOn(ChatContactRepository.prototype, "list").mockResolvedValue([]);
  vi.spyOn(ChatGroupRepository.prototype, "list").mockResolvedValue([
    {
      id: "mentions-group",
      name: "Nur @",
      description: "",
      memberIds: ["agent"],
      lastActivityAt: "2026-01-02",
    },
    {
      id: "decision-group",
      name: "Decision",
      description: "",
      memberIds: ["agent"],
      lastActivityAt: "2026-01-01",
    },
  ]);
  vi.spyOn(AccountIdentityRepository.prototype, "jobTitles").mockResolvedValue(
    new Map(),
  );
  vi.spyOn(AgentConversationRepository.prototype, "find").mockResolvedValue(
    null,
  );
  vi.spyOn(AgentEmployeeRepository.prototype, "find").mockResolvedValue(null);
  vi.spyOn(
    AgentChatMemoryRepository.prototype,
    "confidentialAgents",
  ).mockResolvedValue(new Set());
  vi.spyOn(
    AgentChatMemoryRepository.prototype,
    "confidentialConversations",
  ).mockResolvedValue(new Set());
  const view = (id: string): unknown => ({
    summary: {
      id,
      kind: "group",
      name: id,
      members: [],
      lastMessage: null,
      lastActivityAt: "2026-01-01",
      unreadCount: 0,
      isMuted: false,
    },
    messages: [],
    hasMore: false,
  });
  const replyModes = vi.fn(
    async () => new Map([["mentions-group", "mentions" as const]]),
  );
  const service = new ChatDirectoryService({
    store: new EmployeeStore(database),
    users: { findAll: vi.fn().mockResolvedValue([person, agent]) },
    lookups: { listActiveUsers: vi.fn().mockResolvedValue([person, agent]) },
    messages: { messages: vi.fn().mockResolvedValue([]) },
    conversations: {
      views: vi
        .fn()
        .mockResolvedValue([view("mentions-group"), view("decision-group")]),
      history: vi.fn(),
    },
    isWorking: vi.fn().mockResolvedValue(false),
    replyModes,
  });
  const { groups } = await service.directory(person);
  expect(replyModes).toHaveBeenCalledWith(["mentions-group", "decision-group"]);
  expect(
    Object.fromEntries(groups.map((group) => [group.id, group.replyMode])),
  ).toEqual({ "mentions-group": "mentions", "decision-group": "decision" });
});
