import { expect, it, vi } from "vitest";

import {
  handOverPlanLocks,
  returnHandedOverPlanLocks,
} from "./AgentPlanHandoverLocks";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

const handover = {
  invocationId: "call",
  sourceRunId: "source",
  targetRunId: "target",
  targetKeys: ["resource:a"],
};

function transactionOf(
  answers: readonly (readonly (readonly DatabaseValue[])[])[],
): {
  readonly transaction: DatabaseTransaction;
  readonly execute: ReturnType<typeof vi.fn<DatabaseTransaction["execute"]>>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => []);
  for (const rows of answers)
    query.mockImplementationOnce(async () => rows.map((row) => [...row]));
  return { transaction: { query, execute }, execute };
}

it("moves only the colliding reservations to the called run", async () => {
  const { transaction, execute } = transactionOf([
    [["none", "shared"]],
    [["running"]],
    [["resource:a"], ["resource:b"]],
  ]);

  const moved = await handOverPlanLocks(transaction, handover);

  expect(moved).toEqual(["resource:a"]);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    keys: JSON.stringify(["resource:a"]),
  });
});

it.each([
  ["no call", [[], [["running"]]]],
  ["a handed over call", [[["handed_over", "shared"]], [["running"]]]],
  ["a call without shared workspace", [[["none", "own"]], [["running"]]]],
  ["a missing source run", [[["none", "shared"]], []]],
  ["a finished source run", [[["none", "shared"]], [["succeeded"]]]],
  ["a source run without text status", [[["none", "shared"]], [[null]]]],
])("refuses a handover for %s", async (name, answers) => {
  expect(name).not.toBe("");
  const { transaction } = transactionOf(answers);

  await expect(handOverPlanLocks(transaction, handover)).rejects.toMatchObject({
    code: "plan_jump_handover_unavailable",
  });
});

it("returns the reservations to a calling run that is still active", async () => {
  const { transaction, execute } = transactionOf([
    [
      ["call-1", "source", JSON.stringify(["resource:a", 4])],
      ["call-2", "gone", "[]"],
      ["call-3", "ended", JSON.stringify(["resource:b"])],
      ["call-4", "source", '"not a list"'],
    ],
    [["running"]],
    [],
    [["succeeded"]],
    [["paused"]],
  ]);

  await returnHandedOverPlanLocks(transaction, "target");

  const moves = execute.mock.calls.filter(([statement]) =>
    statement.includes("SET run_id"),
  );
  expect(moves).toHaveLength(1);
  expect(moves[0]?.[1]).toMatchObject({
    source_run_id: "source",
    workspace_id: "resource:a",
  });
  expect(
    execute.mock.calls
      .filter(([statement]) => statement.includes("'returned'"))
      .map(([, parameters]) => parameters),
  ).toEqual([
    { id: "call-1" },
    { id: "call-2" },
    { id: "call-3" },
    { id: "call-4" },
  ]);
});
