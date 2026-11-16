import { expect, it, vi } from "vitest";

import {
  AgentKnowledgeAccess,
  AgentMemorySharing,
} from "@/backend/service/employee/AgentMemorySharing";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { AgentMemorySource } from "@/definition/AgentMemory";

it("shares only same-chat, common-participant or universally visible knowledge", async () => {
  const isConfidential = vi.fn(
    async (
      agentId: string,
      chat: { kind: string; conversationId?: string },
    ) => {
      expect(agentId).toBe("agent");
      return chat.conversationId === "secret";
    },
  );
  const conversationPeople = vi.fn(async () => ["alice", "bob"]);
  const store = partial<EmployeeStore>({
    chats: () => ({ isConfidential, conversationPeople }),
  });
  const canSeeTicket = vi.fn(async (person: string) => person !== "eve");
  const sharing = new AgentMemorySharing({
    store,
    visibility: { canSeeTicket, canSeeWikiPage: async () => true },
  });
  const source = (
    chat: AgentMemorySource["chat"],
    tickets: string[] = [],
  ): AgentMemorySource => ({ chat, tickets, wikiPages: [] });
  const items = [
    { id: "unsourced", source: null },
    {
      id: "same",
      source: source({ kind: "conversation", conversationId: "current" }),
    },
    {
      id: "common",
      source: source({ kind: "conversation", conversationId: "other" }),
    },
    {
      id: "secret",
      source: source({ kind: "conversation", conversationId: "secret" }, [
        "PAGE-1",
      ]),
    },
    { id: "visible", source: source(null, ["PAGE-1"]) },
  ];
  const audience = {
    agentId: "agent",
    chat: { kind: "conversation" as const, conversationId: "current" },
    people: ["alice", "bob"],
  };
  expect(
    (await sharing.filter(audience, items)).map((item) => item.id),
  ).toEqual(["same", "common", "visible"]);
  expect(
    (
      await sharing.filter({ ...audience, people: ["alice", "eve"] }, items)
    ).map((item) => item.id),
  ).toEqual(["same"]);
  expect(
    (await sharing.filter({ ...audience, people: ["alice"] }, [items[0]])).map(
      (item) => item.id,
    ),
  ).toEqual(["unsourced"]);
});

it("checks knowledge with active users and treats read refusals as invisible", async () => {
  const users = partial<
    ConstructorParameters<typeof AgentKnowledgeAccess>[0]["users"]
  >({
    findById: async (id: string) =>
      id === "active" ? { id, isActive: true } : null,
  });
  const tickets = partial<
    ConstructorParameters<typeof AgentKnowledgeAccess>[0]["tickets"]
  >({
    getByKey: async () => {
      throw new Error("hidden");
    },
  });
  const wiki = partial<
    ConstructorParameters<typeof AgentKnowledgeAccess>[0]["wiki"]
  >({ canView: async () => true });
  const access = new AgentKnowledgeAccess({ users, tickets, wiki });
  await expect(access.canSeeTicket("active", "PAGE-1")).resolves.toBe(false);
  await expect(access.canSeeTicket("missing", "PAGE-1")).resolves.toBe(false);
  await expect(access.canSeeWikiPage("active", "page")).resolves.toBe(true);
  await expect(access.canSeeWikiPage("missing", "page")).resolves.toBe(false);
});
