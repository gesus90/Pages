import { expect, it, vi } from "vitest";

import { ConversationDirectory } from "@/backend/service/conversation/ConversationDirectory";

import type { User } from "@/definition/User";

const person: User = {
  id: "person",
  username: "person",
  displayName: "Person",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

it("keeps inactive accounts for display but offers only active directory entries", async () => {
  const agent: User = {
    ...person,
    id: "agent",
    displayName: "Agent",
    isAgent: true,
    avatarColor: "blue",
  };
  const inactive: User = { ...person, id: "inactive", isActive: false };
  const hidden: User = { ...person, id: "hidden" };
  const findAll = vi.fn().mockResolvedValue([person, agent, inactive, hidden]);
  const directory = new ConversationDirectory({
    users: { findAll },
    lookups: {
      listActiveUsers: vi.fn().mockResolvedValue([person, agent, inactive]),
    },
    jobTitles: vi.fn().mockResolvedValue(new Map([["agent", "Research"]])),
  });
  const accounts = await directory.read();
  expect(findAll).toHaveBeenCalledWith(true);
  expect(
    accounts.available("person").map((account) => account.user.id),
  ).toEqual(["agent"]);
  expect(accounts.find("agent")).toMatchObject({
    role: "Research",
    isAvailable: true,
  });
  expect(accounts.participant("agent")).toEqual({
    id: "agent",
    kind: "agent",
    name: "Agent",
    color: "blue",
  });
  expect(accounts.participant("inactive")).toMatchObject({
    id: "inactive",
    name: "Person",
    kind: "human",
  });
  expect(accounts.find("missing")).toBeUndefined();
  expect(accounts.participant("missing")).toEqual({
    id: "missing",
    kind: "human",
    name: "—",
    color: null,
  });
});
