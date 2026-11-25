import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import {
  AgentPlanAgentTodoRepository,
  readEntries,
  saveSwarmTodos,
} from "./AgentPlanAgentTodoRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

const ENTRY = { id: "t1", text: "Do", status: "open", updatedAt: "now" };

interface Harness {
  readonly query: Mock<Database["query"]>;
  readonly execute: Mock<Database["execute"]>;
  readonly repository: AgentPlanAgentTodoRepository;
}

function database(rows: DatabaseValue[][] = []): Harness {
  const query = vi.fn<Database["query"]>(async () => rows);
  const execute = vi.fn<Database["execute"]>(async () => undefined);
  return {
    query,
    execute,
    repository: new AgentPlanAgentTodoRepository({ query, execute }),
  };
}

it("reads the entries of a stored list", () => {
  expect(readEntries(JSON.stringify([ENTRY]))).toEqual([ENTRY]);
});

it("reads no entries from malformed stored JSON content", () => {
  expect(readEntries(JSON.stringify([{ id: "t1" }]))).toEqual([]);
});

it("finds the entries of an attempt", async () => {
  const { repository, query } = database([[JSON.stringify([ENTRY])]]);

  expect(await repository.findEntries("a1")).toEqual([ENTRY]);
  expect(query.mock.calls[0]?.[1]).toEqual({ attempt_id: "a1" });
});

it("finds no entries before the first plan, and tells absence from empty", async () => {
  expect(await database().repository.findEntries("a1")).toEqual([]);
  expect(await database().repository.findPlan("a1")).toBeNull();
  expect(await database([["[]"]]).repository.findPlan("a1")).toEqual([]);
});

it("lists the stored lists of a run", async () => {
  const { repository } = database([["r1", "s1", "a1", "[]", "now"]]);

  expect(await repository.listForRun("r1")).toEqual([
    {
      runId: "r1",
      stepId: "s1",
      attemptId: "a1",
      todosJson: "[]",
      updatedAt: "now",
    },
  ]);
});

it("saves the list of an attempt as JSON", async () => {
  const { repository, execute } = database();

  await repository.save("a1", [{ ...ENTRY, status: "open" }], "later");

  expect(execute.mock.calls[0]?.[1]).toEqual({
    attempt_id: "a1",
    todos_json: JSON.stringify([ENTRY]),
    updated_at: "later",
  });
});

it("saves the list of a swarm worker", async () => {
  const execute = vi.fn<Database["execute"]>(async () => undefined);

  await saveSwarmTodos(
    { execute },
    {
      runId: "r1",
      stepId: "s1",
      attemptId: "a1",
      workerId: "H1",
      todos: [],
      updatedAt: "now",
    },
  );

  expect(execute.mock.calls[0]?.[1]).toEqual({
    run_id: "r1",
    step_id: "s1",
    attempt_id: "a1",
    worker_id: "H1",
    todos_json: "[]",
    updated_at: "now",
  });
});

it.each([
  { name: "stores", rows: [["a1"]], expected: true },
  { name: "keeps a newer list instead of", rows: [], expected: false },
])("$name the list a report slot filed", async ({ rows, expected }) => {
  const { repository, query } = database(rows);

  expect(
    await repository.saveReported(
      { runId: "r1", stepId: "s1", attemptId: "a1" },
      [],
      "now",
    ),
  ).toBe(expected);
  expect(query.mock.calls[0]?.[1]).toEqual({
    run_id: "r1",
    step_id: "s1",
    attempt_id: "a1",
    todos_json: "[]",
    updated_at: "now",
  });
});
