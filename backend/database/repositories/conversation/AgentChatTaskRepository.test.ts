import { expect, it, vi, type Mock } from "vitest";

import {
  AgentChatTaskRepository,
  type StoredAgentChatTask,
} from "./AgentChatTaskRepository";

import type { DatabaseValue } from "@/backend/database/Database";

const GROUP_TASK: StoredAgentChatTask = {
  automationId: "t1",
  agentId: "a1",
  requesterId: "r1",
  chat: { kind: "group", conversationId: "c1" },
  kind: "reminder",
  request: "req",
  instruction: "ins",
  createdAt: "now",
};

const DIRECT_TASK: StoredAgentChatTask = {
  ...GROUP_TASK,
  chat: { kind: "direct", personId: "p1" },
  kind: "task",
};

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: AgentChatTaskRepository;
  readonly execute: Mock;
  readonly query: Mock;
} {
  const execute = vi.fn(async () => {});
  const query = vi.fn(async () => rows);
  return {
    repository: new AgentChatTaskRepository({ execute, query }),
    execute,
    query,
  };
}

function parametersOf(mock: ReturnType<typeof vi.fn>): unknown {
  return (mock.mock.calls[0] as unknown[])[1];
}

it("inserts a group task bound to its conversation", async () => {
  const { repository, execute } = repositoryOf();
  await repository.insert(GROUP_TASK);
  expect(parametersOf(execute)).toMatchObject({
    chat_kind: "group",
    conversation_id: "c1",
    person_id: null,
    kind: "reminder",
  });
});

it("inserts a direct task bound to its person", async () => {
  const { repository, execute } = repositoryOf();
  await repository.insert(DIRECT_TASK);
  expect(parametersOf(execute)).toMatchObject({
    chat_kind: "direct",
    conversation_id: null,
    person_id: "p1",
  });
});

it("finds no binding for an automation of no chat", async () => {
  const { repository } = repositoryOf();
  await expect(repository.find("x")).resolves.toBeNull();
});

it("reads a group binding and an unknown kind as task", async () => {
  const { repository } = repositoryOf([
    ["t1", "a1", "r1", "group", "c1", null, "reminder", "req", "ins", "now"],
  ]);
  await expect(repository.find("t1")).resolves.toEqual(GROUP_TASK);
  const other = repositoryOf([
    ["t1", "a1", "r1", "direct", null, "p1", "other", "req", "ins", "now"],
  ]);
  await expect(other.repository.find("t1")).resolves.toEqual(DIRECT_TASK);
});

it("reads a direct binding without person as empty person", async () => {
  const { repository } = repositoryOf([
    ["t1", "a1", "r1", "direct", null, null, "task", "req", "ins", "now"],
  ]);
  await expect(repository.find("t1")).resolves.toMatchObject({
    chat: { kind: "direct", personId: "" },
  });
});

it("lists the tasks of a group chat for every agent", async () => {
  const { repository, query } = repositoryOf([
    ["t1", "a1", "r1", "group", "c1", null, "task", "req", "ins", "now"],
  ]);
  await expect(
    repository.listForChat(GROUP_TASK.chat, null),
  ).resolves.toHaveLength(1);
  expect(parametersOf(query)).toEqual({ conversation_id: "c1" });
});

it("lists the tasks of one agent in a direct chat", async () => {
  const { repository, query } = repositoryOf();
  await repository.listForChat(DIRECT_TASK.chat, "a1");
  expect(parametersOf(query)).toEqual({ person_id: "p1", agent_id: "a1" });
  const group = repositoryOf();
  await group.repository.listForChat(GROUP_TASK.chat, "a1");
  expect(parametersOf(group.query)).toEqual({
    conversation_id: "c1",
    agent_id: "a1",
  });
});

it("counts the tasks of a chat", async () => {
  const row: DatabaseValue[] = [
    "t1",
    "a1",
    "r1",
    "group",
    "c1",
    null,
    "task",
    "req",
    "ins",
    "now",
  ];
  const { repository } = repositoryOf([row, row]);
  await expect(repository.countForChat(GROUP_TASK.chat)).resolves.toBe(2);
});

it("updates the texts of a task", async () => {
  const { repository, execute } = repositoryOf();
  await repository.updateTexts("t1", { request: "a", instruction: "b" });
  expect(parametersOf(execute)).toEqual({
    automation_id: "t1",
    request: "a",
    instruction: "b",
  });
});

it("deletes a task by its automation", async () => {
  const { repository, execute } = repositoryOf();
  await repository.delete("t1");
  expect(parametersOf(execute)).toEqual({ automation_id: "t1" });
});
