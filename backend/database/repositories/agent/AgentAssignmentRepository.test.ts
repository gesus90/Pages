import { expect, it, vi, type Mock } from "vitest";

import { Database } from "@/backend/database/Database";

import { AgentAssignmentRepository } from "./AgentAssignmentRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function transactionOf(rows: DatabaseValue[][] = []): {
  readonly transaction: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  return {
    transaction: { execute, query: async () => rows },
    execute,
  };
}

function bareDatabase(): Database {
  const value: unknown = Object.create(Database.prototype);
  if (!(value instanceof Database)) throw new Error("Not a database");
  return value;
}

it("lists assignments with their optional reasoning effort", async () => {
  const { transaction } = transactionOf([
    ["skills", "c1", "m1", "high"],
    ["skills", "c2", "m2", null],
  ]);
  const listed = await new AgentAssignmentRepository(transaction).list();
  expect(listed).toEqual([
    {
      function: "skills",
      connectionId: "c1",
      model: "m1",
      reasoningEffort: "high",
    },
    {
      function: "skills",
      connectionId: "c2",
      model: "m2",
      reasoningEffort: null,
    },
  ]);
});

it("rejects an assignment with an unknown function", async () => {
  const { transaction } = transactionOf([["nonsense", "c1", "m1", null]]);
  await expect(
    new AgentAssignmentRepository(transaction).list(),
  ).rejects.toMatchObject({ code: "function_invalid" });
});

it("removes an assignment inside the given transaction", async () => {
  const { transaction, execute } = transactionOf();
  await new AgentAssignmentRepository(transaction).remove("skills");
  expect(execute.mock.calls[0]?.[1]).toEqual({ function: "skills" });
});

it("opens a transaction when it was given the database itself", async () => {
  const { transaction, execute } = transactionOf();
  const database = bareDatabase();
  const run = vi
    .spyOn(database, "transaction")
    .mockImplementation(async (work) => work(transaction));
  await new AgentAssignmentRepository(database).remove("skills");
  expect(run).toHaveBeenCalledOnce();
  expect(execute).toHaveBeenCalledOnce();
});
