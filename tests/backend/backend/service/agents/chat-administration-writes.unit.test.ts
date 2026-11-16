import { expect, it, vi } from "vitest";

import { applyChatAdministration } from "@/backend/service/agents/ChatAdministrationWrites";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentAdministrationContext } from "@/backend/service/agents/AgentAdministrationContext";

it("creates a group through the administration service", async () => {
  const saveGroup = vi.fn(async () => {});
  const context = partial<AgentAdministrationContext>({
    channel: "chat",
    actor: { id: "actor" },
    groups: { saveGroup },
  });
  const result = await applyChatAdministration(context, "admin.groups.create", {
    name: " Team ",
    memberIds: ["one", "two"],
  });
  expect(result.result).toMatchObject({
    targetType: "group",
    changed: true,
    affectedUserIds: ["one", "two"],
  });
  expect(saveGroup).toHaveBeenCalledWith(
    "actor",
    expect.objectContaining({ name: "Team", memberIds: ["one", "two"] }),
  );
});

it("checks the group name and membership snapshot before removal", async () => {
  const deleteGroup = vi.fn(async () => {});
  const context = partial<AgentAdministrationContext>({
    channel: "chat",
    actor: { id: "actor" },
    repository: {
      groups: () => ({
        findAll: async () => [
          { id: "group", name: "Team", memberIds: ["one", "two"] },
        ],
      }),
    },
    groups: { deleteGroup },
  });
  await expect(
    applyChatAdministration(context, "admin.groups.delete", {
      groupId: "group",
      expectedName: "Old",
      expectedMemberIds: ["one", "two"],
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(deleteGroup).not.toHaveBeenCalled();
  await expect(
    applyChatAdministration(context, "admin.groups.delete", {
      groupId: "group",
      expectedName: "Team",
      expectedMemberIds: ["two", "one"],
    }),
  ).resolves.toMatchObject({ result: { changed: true } });
  expect(deleteGroup).toHaveBeenCalledWith("actor", "group");
});

it("rejects use outside the chat administration channel", async () => {
  await expect(
    applyChatAdministration(
      partial<AgentAdministrationContext>({ channel: "mcp" }),
      "admin.groups.create",
      {},
    ),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});
