import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatGroupMembershipService } from "@/backend/service/employee/ChatGroupMembershipService";

import type { ChatGroupMembershipDependencies } from "@/backend/service/employee/ChatGroupMembershipService";
import type { User } from "@/definition/User";

function user(id: string, fields: Partial<User> = {}): User {
  return {
    id,
    username: id,
    displayName: id.charAt(0).toUpperCase() + id.slice(1),
    role: "employee",
    isActive: true,
    mustChangePassword: false,
    ...fields,
  };
}

const igor = user("igor");
const anna = user("anna");
const ed = user("ed", { isAgent: true });
const mei = user("mei", { isAgent: true });
const ACCOUNTS = new Map(
  [igor, anna, ed, mei].map((entry) => [entry.id, entry]),
);

const calls = {
  stopAnswer: vi.fn(),
  close: vi.fn(),
  removeModel: vi.fn(),
  removeModels: vi.fn(),
  removeGroupMember: vi.fn(),
  removeGroup: vi.fn(),
  removeController: vi.fn(),
  replaceControllers:
    vi.fn<
      (groupId: string, payload: { userIds: string[]; at: string }) => void
    >(),
  removeMember: vi.fn(),
  removeConversation: vi.fn(),
  systemLine: vi.fn(),
  removeRow: vi.fn(),
};

/** A store with the repositories of the membership only: memory, dreams, lessons, recipes and the Lagebuch are out of reach. */
function service(): ChatGroupMembershipService {
  const store = {
    groups: () => ({
      removeMember: calls.removeGroupMember,
      remove: calls.removeGroup,
    }),
    sessionControllers: () => ({
      list: async () => ["anna"],
      remove: calls.removeController,
      replace: calls.replaceControllers,
    }),
    chatModels: () => ({
      remove: calls.removeModel,
      removeForChat: calls.removeModels,
      forChat: async () => [
        {
          agentId: "ed",
          chatKind: "group",
          chatId: "team",
          connectionId: "claude",
          model: "claude-opus-5-5",
          reasoningEffort: "high",
        },
      ],
    }),
    conversations: () => ({
      find: async (agentId: string) => ({ sessionId: `session-${agentId}` }),
    }),
    chatSessions: () => ({ remove: calls.removeRow }),
    identities: () => ({
      jobTitles: async () => new Map([["ed", "Entwickler"]]),
    }),
  };
  return new ChatGroupMembershipService({
    store,
    users: { findById: async (id: string) => ACCOUNTS.get(id) ?? null },
    access: {
      isOwner: async (viewer: User) => viewer.id === "igor",
      groupMembers: async () => ["igor", "anna", "ed", "mei"],
      canControlGroup: async () => false,
    },
    conversations: {
      removeMember: calls.removeMember,
      removeGroup: calls.removeConversation,
      postSystemLine: calls.systemLine,
    },
    lifecycle: { close: calls.close },
    models: {
      describe: async () => ({
        modelName: "Claude Opus 5.5",
        provider: "claude_code",
      }),
    },
    stopAnswer: calls.stopAnswer,
  } as unknown as ChatGroupMembershipDependencies);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("removing members of a group (PAGE-380)", () => {
  it("lets only the owner remove; another member or an agent changes nothing", async () => {
    await expect(
      service().removeMember(anna, "team", "ed"),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      service().removeMember(ed, "team", "mei"),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      service().removeMember(igor, "team", "igor"),
    ).rejects.toMatchObject({
      code: "invalidInput",
    });
    expect(calls.close).not.toHaveBeenCalled();
    expect(calls.removeMember).not.toHaveBeenCalled();
  });

  it("closes and deletes the session and the model of a removed agent and leaves a system line", async () => {
    await service().removeMember(igor, "team", "ed");
    expect(calls.stopAnswer).toHaveBeenCalledWith(igor, "team", "ed");
    expect(calls.removeModel).toHaveBeenCalledWith({
      agentId: "ed",
      chatKind: "group",
      chatId: "team",
    });
    expect(calls.close).toHaveBeenCalledWith(ed, "session-ed", {
      isAborted: true,
    });
    expect(calls.removeGroupMember).toHaveBeenCalledWith("igor", "team", "ed");
    expect(calls.removeController).toHaveBeenCalledWith("team", "ed");
    expect(calls.removeMember).toHaveBeenCalledWith(igor, {
      conversationId: "team",
      memberId: "ed",
    });
    expect(calls.systemLine).toHaveBeenCalledWith(igor, {
      conversationId: "team",
      text: "Igor hat Ed aus der Gruppe entfernt.",
    });
  });

  it("deletes the row of the session even when closing it failed", async () => {
    calls.close.mockRejectedValue(new Error("process gone"));
    await service().removeMember(igor, "team", "ed");
    expect(calls.removeRow).toHaveBeenCalledWith("session-ed");
    expect(calls.removeMember).toHaveBeenCalled();
  });

  it("removes a person, who no longer sees the group, without touching sessions", async () => {
    await service().removeMember(igor, "team", "anna");
    expect(calls.close).not.toHaveBeenCalled();
    expect(calls.removeMember).toHaveBeenCalledWith(igor, {
      conversationId: "team",
      memberId: "anna",
    });
    expect(calls.systemLine).toHaveBeenCalledWith(
      igor,
      expect.objectContaining({
        text: "Igor hat Anna aus der Gruppe entfernt.",
      }),
    );
  });
});

describe("dissolving a group (PAGE-380)", () => {
  it("closes every agent session, deletes the models, the group and its history", async () => {
    await service().dissolve(igor, "team");
    expect(calls.stopAnswer).toHaveBeenCalledTimes(2);
    expect(calls.close).toHaveBeenCalledWith(ed, "session-ed", {
      isAborted: true,
    });
    expect(calls.close).toHaveBeenCalledWith(mei, "session-mei", {
      isAborted: true,
    });
    expect(calls.removeModels).toHaveBeenCalledWith("group", "team");
    expect(calls.removeGroup).toHaveBeenCalledWith("igor", "team");
    expect(calls.removeConversation).toHaveBeenCalledWith(igor, "team");
  });

  it("refuses everybody but the owner", async () => {
    await expect(service().dissolve(anna, "team")).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(calls.close).not.toHaveBeenCalled();
    expect(calls.removeConversation).not.toHaveBeenCalled();
  });
});

describe("the members dialog and who steers (PAGE-380)", () => {
  it("lists persons and agents with owner, right and model of the group", async () => {
    const view = await service().members(igor, "team");
    expect(view.canManage).toBe(true);
    expect(
      view.members.map((member) => [member.id, member.kind, member.canControl]),
    ).toEqual([
      ["igor", "human", true],
      ["anna", "human", true],
      ["ed", "agent", false],
      ["mei", "agent", false],
    ]);
    expect(view.members[0]?.isOwner).toBe(true);
    expect(view.members[2]).toMatchObject({
      role: "Entwickler",
      model: {
        name: "Claude Opus 5.5",
        reasoningEffort: "high",
        isOverride: true,
      },
    });
  });

  it("lets only the owner choose the persons that steer, never an agent", async () => {
    await expect(
      service().saveControllers(anna, "team", ["anna"]),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service().saveControllers(igor, "team", ["ed"]),
    ).rejects.toMatchObject({ code: "invalidInput" });
    await service().saveControllers(igor, "team", ["anna", "igor"]);
    expect(calls.replaceControllers).toHaveBeenCalledOnce();
    const call = calls.replaceControllers.mock.calls[0];
    expect(call?.[0]).toBe("team");
    expect(call?.[1].userIds).toEqual(["anna"]);
    expect(typeof call?.[1].at).toBe("string");
  });
});
