import { expect, it, vi } from "vitest";

import { ChatContactRepository } from "./ChatContactRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function doubleOf(rows: DatabaseValue[][]): {
  repository: ChatContactRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  const transaction = {
    query,
    execute,
  };
  return {
    repository: new ChatContactRepository({
      query,
      execute,
      transaction: async (operation: (tx: unknown) => Promise<unknown>) =>
        operation(transaction),
    } as unknown as Database),
    query,
    execute,
  };
}

it("lists a person's contacts", async () => {
  const { repository, query } = doubleOf([["c1", "t1"]]);

  expect(await repository.list("o1")).toEqual([
    { contactId: "c1", lastActivityAt: "t1" },
  ]);
  expect(query.mock.calls[0]?.[1]).toEqual({ owner_id: "o1" });
});

it("replaces the list: removes missing, keeps kept, adds new", async () => {
  const { repository, execute } = doubleOf([["gone"], ["kept"]]);

  await repository.replace("o1", new Map([["new", "t"]]), ["kept"]);

  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    owner_id: "o1",
    contact_id: "gone",
  });
  expect(execute.mock.calls[1]?.[1]).toEqual({
    owner_id: "o1",
    contact_id: "new",
    last_activity_at: "t",
  });
});

it("touches an entry and reports whether it exists", async () => {
  expect(await doubleOf([["c1"]]).repository.touch("o", "c1", "t")).toBe(true);
  expect(await doubleOf([]).repository.touch("o", "c1", "t")).toBe(false);
});
