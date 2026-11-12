import { expect, it, vi } from "vitest";

import { ConversationOversight } from "@/backend/service/conversation/ConversationOversight";

import type { AccountAccess } from "@/definition/Authorization";
import type { Mock } from "vitest";
import type { User } from "@/definition/User";

const viewer: User = {
  id: "viewer",
  username: "viewer",
  displayName: "Viewer",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const account: AccountAccess = {
  userId: "viewer",
  role: null,
  isAdmin: false,
  mode: "role",
  firstName: "View",
  lastName: "Er",
  isActive: true,
  departments: [],
  managedDepartments: ["dept"],
  allDepartments: false,
  allProjects: false,
  hasHadDepartment: false,
};
const record = {
  id: "group",
  kind: "group",
  name: "Team",
  lastActivityAt: "2026-01-01",
} as const;

function fixture(accounts: AccountAccess[]): {
  authorization: { snapshot: Mock };
  chat: Record<"listAgentOnly" | "findAgentOnly" | "projectMemberIds", Mock>;
  reader: Record<"inspect" | "inspectHistory" | "memberIds", Mock>;
  oversight: ConversationOversight;
} {
  const authorization = {
    snapshot: vi
      .fn()
      .mockResolvedValue({ accounts, roles: [], departments: [] }),
  };
  const chat = {
    listAgentOnly: vi.fn().mockResolvedValue([record]),
    findAgentOnly: vi.fn().mockResolvedValue(record),
    projectMemberIds: vi.fn().mockResolvedValue(["project-agent"]),
  };
  const reader = {
    inspect: vi.fn().mockResolvedValue(["view"]),
    inspectHistory: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
    memberIds: vi.fn().mockResolvedValue(["department-agent"]),
  };
  return {
    authorization,
    chat,
    reader,
    oversight: new ConversationOversight({ authorization, chat, reader }),
  };
}

it("limits leaders to active agents in managed departments or projects", async () => {
  const agents: AccountAccess[] = [
    {
      ...account,
      userId: "department-agent",
      isAgent: true,
      departments: ["dept"],
    },
    { ...account, userId: "project-agent", isAgent: true },
    {
      ...account,
      userId: "inactive",
      isAgent: true,
      isActive: false,
      departments: ["dept"],
    },
    { ...account, userId: "unrelated", isAgent: true },
  ];
  const { oversight, chat, reader } = fixture([account, ...agents]);
  await expect(oversight.views(viewer)).resolves.toEqual(["view"]);
  expect(chat.listAgentOnly).toHaveBeenCalledWith(
    ["department-agent", "project-agent"],
    200,
  );
  await expect(oversight.canOversee(viewer, "group")).resolves.toBe(true);
  await expect(oversight.history(viewer, "group", "before")).resolves.toEqual({
    messages: [],
    hasMore: false,
  });
  expect(reader.inspectHistory).toHaveBeenCalledWith("group", "before");
  reader.memberIds.mockResolvedValueOnce(["unrelated"]);
  await expect(oversight.history(viewer, "group", null)).rejects.toMatchObject({
    code: "not_found",
  });
});

it("grants active administrators all conversations and refuses inactive or agent viewers", async () => {
  const admin = fixture([{ ...account, isAdmin: true, mode: "admin" }]);
  await admin.oversight.views(viewer);
  expect(admin.chat.listAgentOnly).toHaveBeenCalledWith(null, 200);
  await expect(admin.oversight.canOversee(viewer, "group")).resolves.toBe(true);
  expect(admin.reader.memberIds).not.toHaveBeenCalled();
  for (const accounts of [
    [],
    [{ ...account, isActive: false }],
    [{ ...account, isAgent: true }],
    [account],
  ]) {
    const denied = fixture(accounts);
    await expect(denied.oversight.views(viewer)).resolves.toEqual([]);
    await expect(
      denied.oversight.history(viewer, "group", null),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(denied.chat.findAgentOnly).not.toHaveBeenCalled();
  }
});
