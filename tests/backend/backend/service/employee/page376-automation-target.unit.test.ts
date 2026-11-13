import { expect, it, vi } from "vitest";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { AutomationAgentBusyError } from "@/backend/service/automation/AutomationAgentWorker";
import {
  AgentAutomationTarget,
  AutomationTargetError,
} from "@/backend/service/employee/AgentAutomationTarget";
import { AgentAutomationTurns } from "@/backend/service/employee/AgentAutomationTurns";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { AgentAutomationTurnDependencies } from "@/backend/service/employee/AgentAutomationTurns";
import type { User } from "@/definition/User";

const owner: User = {
  id: "owner",
  username: "igor",
  displayName: "Igor",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const agent: User = {
  ...owner,
  id: "agent",
  username: "all-might",
  displayName: "All Might",
  isAgent: true,
};

function storeWithGroups(groups: Record<string, string>): {
  readonly store: EmployeeStore;
  readonly findGroupByName: ReturnType<typeof vi.fn>;
} {
  const findGroupByName = vi.fn(async (name: string) => groups[name.toLowerCase()] ?? null);
  const store = {
    conversations: () => ({ findGroupByName }),
    employees: () => ({ find: vi.fn(async () => ({ revision: 1 })) }),
  } as unknown as EmployeeStore;
  return { store, findGroupByName };
}

it("runs an automation without a target and with @Agentname in the direct chat of its owner with the agent", async () => {
  const { store } = storeWithGroups({});
  const target = new AgentAutomationTarget(store);
  for (const chat of [undefined, null, "", "@All Might", "@all-might", "@ALL MIGHT"])
    await expect(target.resolve({ agent, owner, chat })).resolves.toEqual({ kind: "direct", person: owner });
});

it("runs an automation with [[Chatname]] in the group of that name the owner and the agent share", async () => {
  const { store, findGroupByName } = storeWithGroups({ "pages team": "group-1" });
  const target = new AgentAutomationTarget(store);
  await expect(target.resolve({ agent, owner, chat: "[[Pages Team]]" })).resolves.toEqual({
    kind: "group",
    conversationId: "group-1",
    name: "Pages Team",
    person: owner,
  });
  expect(findGroupByName).toHaveBeenCalledWith("Pages Team", ["agent", "owner"]);
  await expect(target.resolve({ agent, owner, chat: "[[Gang]]" })).rejects.toMatchObject({ code: "target_chat_not_found" });
});

it("refuses a target that names another agent or is neither form, and gives an owner without a direct chat its own session", async () => {
  const { store } = storeWithGroups({});
  const target = new AgentAutomationTarget(store);
  for (const chat of ["@Conan", "Pages Team", "[[]]", "#Chat"])
    await expect(target.resolve({ agent, owner, chat })).rejects.toBeInstanceOf(AutomationTargetError);
  await expect(target.resolve({ agent, owner: { ...owner, isAgent: true }, chat: null })).resolves.toEqual({ kind: "own" });
  await expect(target.resolve({ agent, owner: null, chat: "@All Might" })).resolves.toEqual({ kind: "own" });
});

interface TurnFixture {
  readonly turns: AgentAutomationTurns;
  readonly run: ReturnType<typeof vi.fn>;
  readonly postResult: ReturnType<typeof vi.fn>;
}

function turnFixture(groups: Record<string, string> = {}): TurnFixture {
  const { store } = storeWithGroups(groups);
  const run = vi.fn(async () => ({
    sessionId: "chat-session",
    start: { job: { id: "job" } },
  }));
  const postResult = vi.fn(async () => undefined);
  const dependencies = {
    store,
    users: { findById: vi.fn(async (id: string) => (id === "agent" ? agent : id === "owner" ? owner : null)) },
    sessions: {
      run,
      job: vi.fn(async () => ({ state: "completed" })),
    },
    messages: {
      messages: vi.fn(async () => [
        { id: "answer", role: "assistant", content: "Tagesbericht fertig" },
      ]),
    },
    chatPoster: { postResult },
    simulation: null,
    now: () => new Date("2026-03-04T10:00:00.000Z"),
  };
  return {
    turns: new AgentAutomationTurns(dependencies as unknown as AgentAutomationTurnDependencies),
    run,
    postResult,
  };
}

const REQUEST = {
  agentId: "agent",
  creatorId: "owner",
  sessionKey: "automation:a1",
  prompt: "[Automation „Tagesbericht“ · Lauf r1]\nBericht",
  runKey: "run-1",
};

it("runs an automation in the one session of the direct chat, where the agent's answer is its message", async () => {
  const { turns, run, postResult } = turnFixture();
  const turn = await turns.start(REQUEST);
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      agent,
      person: owner,
      purpose: "chat",
      text: REQUEST.prompt,
      isScheduled: true,
    }),
  );
  await expect(turn.answer).resolves.toBe("Tagesbericht fertig");
  // The job stored the answer in the chat session; nothing is posted twice.
  expect(postResult).not.toHaveBeenCalled();
  expect(turn.sessionId).toBe("chat-session");
});

it("runs an automation with [[Chatname]] in the session of that group and posts the result there as the agent's message", async () => {
  const { turns, run, postResult } = turnFixture({ "pages team": "group-1" });
  const turn = await turns.start({ ...REQUEST, chat: "[[Pages Team]]" });
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      purpose: "conversation",
      conversationId: "group-1",
      conversationLabel: "Gruppe „Pages Team“",
    }),
  );
  await turn.answer;
  expect(postResult).toHaveBeenCalledWith("agent", {
    conversationId: "group-1",
    key: "run-1",
    text: "Tagesbericht fertig",
  });
});

it("keeps a session of its own for an owner who is no person, and waits when the agent is busy", async () => {
  const fixture = turnFixture();
  await fixture.turns.start({ ...REQUEST, creatorId: "agent" });
  expect(fixture.run).toHaveBeenCalledWith(
    expect.objectContaining({ purpose: "automation", conversationId: "automation:a1", person: null }),
  );
  fixture.run.mockRejectedValueOnce(new AgentEmployeeError("busy"));
  await expect(fixture.turns.start(REQUEST)).rejects.toBeInstanceOf(AutomationAgentBusyError);
});

it("fails a run whose target chat does not exist before anything starts", async () => {
  const { turns, run } = turnFixture();
  await expect(turns.start({ ...REQUEST, chat: "[[Gibt es nicht]]" })).rejects.toMatchObject({
    code: "target_chat_not_found",
  });
  expect(run).not.toHaveBeenCalled();
});
