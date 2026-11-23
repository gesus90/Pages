import { expect, it, vi, type Mock } from "vitest";

import { ConversationAgentChatRepository } from "./ConversationAgentChatRepository";

import type { DatabaseValue } from "@/backend/database/Database";

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: ConversationAgentChatRepository;
  readonly execute: Mock;
  readonly query: Mock;
} {
  const execute = vi.fn(async () => {});
  const query = vi.fn(async () => rows);
  const repository = new ConversationAgentChatRepository({
    query,
    transaction: async (work) => work({ query, execute }),
  });
  return {
    repository,
    execute,
    query,
  };
}

function parametersOf(mock: ReturnType<typeof vi.fn>): unknown {
  return (mock.mock.calls[0] as unknown[])[1];
}

const RECORD_ROW: DatabaseValue[] = ["c1", "group", "Team", "now"];

it("counts the chain of agent messages", async () => {
  const { repository, query } = repositoryOf([[BigInt(4)]]);
  await expect(repository.chainLength("c1")).resolves.toBe(4);
  expect(parametersOf(query)).toEqual({ conversation_id: "c1" });
  await expect(repositoryOf().repository.chainLength("c1")).resolves.toBe(0);
});

it("releases a conversation and appends its event", async () => {
  const { repository, execute } = repositoryOf();
  await repository.release("c1", { type: "conversation", id: "c1" });
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0]).toHaveProperty("1", {
    conversation_id: "c1",
  });
});

it("counts the messages sent since a moment", async () => {
  const { repository, query } = repositoryOf([[2]]);
  await expect(repository.sentSince("s", "t", "send:")).resolves.toBe(2);
  expect(parametersOf(query)).toEqual({
    sender_id: "s",
    since: "t",
    send_prefix: "send:",
  });
  await expect(
    repositoryOf().repository.sentSince("s", "t", "p"),
  ).resolves.toBe(0);
});

it("lists nothing for an empty agent filter", async () => {
  const { repository, query } = repositoryOf();
  await expect(repository.listAgentOnly([], 5)).resolves.toEqual([]);
  expect(query).not.toHaveBeenCalled();
});

it("lists every agent-only conversation without a filter", async () => {
  const { repository, query } = repositoryOf([
    RECORD_ROW,
    ["c2", "other", "Pair", "then"],
  ]);
  await expect(repository.listAgentOnly(null, 5)).resolves.toEqual([
    { id: "c1", kind: "group", name: "Team", lastActivityAt: "now" },
    { id: "c2", kind: "direct", name: "Pair", lastActivityAt: "then" },
  ]);
  expect(parametersOf(query)).toEqual({ limit: 5 });
});

it("lists the conversations of the given agents", async () => {
  const { repository, query } = repositoryOf([RECORD_ROW]);
  await repository.listAgentOnly(["a1", "a2"], 3);
  expect(parametersOf(query)).toMatchObject({ limit: 3 });
  expect(Object.values(parametersOf(query) as object)).toEqual(
    expect.arrayContaining(["a1", "a2"]),
  );
});

it("finds an agent-only conversation or null", async () => {
  await expect(
    repositoryOf([RECORD_ROW]).repository.findAgentOnly("c1"),
  ).resolves.toMatchObject({ id: "c1" });
  await expect(
    repositoryOf().repository.findAgentOnly("c1"),
  ).resolves.toBeNull();
});

it("lists the project members of a manager", async () => {
  const { repository, query } = repositoryOf([["u1"], ["u2"]]);
  await expect(repository.projectMemberIds("m")).resolves.toEqual(["u1", "u2"]);
  expect(parametersOf(query)).toEqual({ manager_id: "m" });
});
