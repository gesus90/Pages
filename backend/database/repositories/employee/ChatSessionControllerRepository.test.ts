import { expect, it, vi } from "vitest";

import { ChatSessionControllerRepository } from "./ChatSessionControllerRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function doubleOf(rows: DatabaseValue[][]): {
  repository: ChatSessionControllerRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  const transaction = { query, execute };
  return {
    repository: new ChatSessionControllerRepository({
      query,
      execute,
      transaction: async (operation: (tx: unknown) => Promise<unknown>) =>
        operation(transaction),
    } as unknown as Database),
    query,
    execute,
  };
}

it("lists the allowed members", async () => {
  const { repository, query } = doubleOf([["u1"], ["u2"]]);

  expect(await repository.list("c1")).toEqual(["u1", "u2"]);
  expect(query.mock.calls[0]?.[1]).toEqual({ conversation_id: "c1" });
});

it("replaces the members: clears then inserts each", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.replace("c1", { userIds: ["u1", "u2"], at: "t" });

  expect(execute).toHaveBeenCalledTimes(3);
  expect(execute.mock.calls[0]?.[1]).toEqual({ conversation_id: "c1" });
  expect(execute.mock.calls[2]?.[1]).toEqual({
    conversation_id: "c1",
    user_id: "u2",
    added_at: "t",
  });
});

it("removes one member", async () => {
  const { repository, execute } = doubleOf([]);

  await repository.remove("c1", "u1");

  expect(execute.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c1",
    user_id: "u1",
  });
});
