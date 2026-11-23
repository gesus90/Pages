import { expect, it, vi } from "vitest";

import { AgentChatModelRepository } from "./AgentChatModelRepository";

import type { Database } from "@/backend/database/Database";

function doubleOf(rows: unknown[][]): {
  repository: AgentChatModelRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new AgentChatModelRepository({
      query,
      execute,
    } as unknown as Database),
    query,
    execute,
  };
}

const KEY = { agentId: "a", chatKind: "group", chatId: "c" } as const;

it("finds a stored choice or nothing", async () => {
  const found = doubleOf([["a", "group", "c", "conn", "m", "high"]]);
  const none = doubleOf([]);

  expect(await found.repository.find(KEY)).toEqual({
    agentId: "a",
    chatKind: "group",
    chatId: "c",
    connectionId: "conn",
    model: "m",
    reasoningEffort: "high",
  });
  expect(await none.repository.find(KEY)).toBeNull();
});

it("lists the choices of a chat with direct as the fallback kind", async () => {
  const { repository, query } = doubleOf([
    ["a", "other", "c", "conn", "m", null],
  ]);

  const models = await repository.forChat("direct", "c");

  expect(models[0]).toMatchObject({
    chatKind: "direct",
    reasoningEffort: null,
  });
  expect(query.mock.calls[0]?.[1]).toEqual({
    chat_kind: "direct",
    chat_id: "c",
  });
});

it("saves, removes and clears choices", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.save(
    {
      ...KEY,
      connectionId: "conn",
      model: "m",
      reasoningEffort: null,
    },
    { changedBy: "u", changedAt: "t" },
  );
  await repository.remove(KEY);
  await repository.removeForChat("group", "c");

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    connection_id: "conn",
    changed_by: "u",
    changed_at: "t",
  });
  expect(execute.mock.calls[1]?.[1]).toEqual({
    agent_id: "a",
    chat_kind: "group",
    chat_id: "c",
  });
  expect(execute.mock.calls[2]?.[1]).toEqual({
    chat_kind: "group",
    chat_id: "c",
  });
});
