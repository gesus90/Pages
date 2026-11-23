import { expect, it, vi } from "vitest";

import { AgentConversationRepository } from "./AgentConversationRepository";

import type { Database } from "@/backend/database/Database";

function doubleOf(...results: unknown[][][]): {
  repository: AgentConversationRepository;
  query: ReturnType<typeof vi.fn>;
  transactionExecute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => results.shift() ?? []);
  const transactionExecute = vi.fn(async () => undefined);
  const transaction = vi.fn(
    async (work: (tx: unknown) => Promise<void>): Promise<void> =>
      work({ execute: transactionExecute }),
  );
  return {
    repository: new AgentConversationRepository({
      query,
      execute: vi.fn(),
      transaction,
    } as unknown as Database),
    query,
    transactionExecute,
  };
}

it("finds a conversation or nothing", async () => {
  const { repository } = doubleOf([["s1"]], []);

  expect(await repository.find("a", "p", "chat")).toEqual({
    sessionId: "s1",
    agentId: "a",
    personId: "p",
    purpose: "chat",
  });
  expect(await repository.find("a", "p", "chat")).toBeNull();
});

it("finds a group by name, repeating a single member", async () => {
  const { repository, query } = doubleOf([["g1"]], []);

  expect(await repository.findGroupByName("Team", ["m"])).toBe("g1");
  expect(query.mock.calls[0]?.[1]).toEqual({
    name: "Team",
    first_member: "m",
    second_member: "m",
  });
  expect(await repository.findGroupByName("Team", [])).toBeNull();
  expect(query.mock.calls[1]?.[1]).toMatchObject({
    first_member: "",
    second_member: "",
  });
});

it("finds the name of a shared group", async () => {
  const { repository, query } = doubleOf([["Team"]], []);

  expect(await repository.findSharedGroup("c", ["a", "b"])).toBe("Team");
  expect(query.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c",
    first_member: "a",
    second_member: "b",
  });
  expect(await repository.findSharedGroup("c", [])).toBeNull();
});

it("returns an existing conversation without storing", async () => {
  const { repository, transactionExecute } = doubleOf([["s1"]]);

  const conversation = await repository.ensure(
    { agentId: "a", personId: "p", purpose: "chat" },
    "new",
  );

  expect(conversation.sessionId).toBe("s1");
  expect(transactionExecute).not.toHaveBeenCalled();
});

it("creates the session and conversation when missing", async () => {
  const { repository, transactionExecute } = doubleOf([], [["new"]]);

  const conversation = await repository.ensure(
    { agentId: "a", personId: "p", purpose: "memory" },
    "new",
  );

  expect(conversation.sessionId).toBe("new");
  expect(transactionExecute).toHaveBeenCalledTimes(2);
});

it("fails when the conversation is still missing after storing", async () => {
  const { repository } = doubleOf([], []);

  await expect(
    repository.ensure({ agentId: "a", personId: "p", purpose: "chat" }, "n"),
  ).rejects.toThrow("The agent conversation was not stored.");
});
