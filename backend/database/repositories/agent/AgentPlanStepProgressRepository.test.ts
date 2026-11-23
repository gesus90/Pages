import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { AgentPlanStepProgressRepository } from "./AgentPlanStepProgressRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

const ROW = ["r1", "s1", "a1", "[]", null, "2026-01-01T00:00:00.000Z"];

function database(rows: DatabaseValue[][]): {
  query: Mock<Database["query"]>;
  execute: Mock<Database["execute"]>;
} {
  const query = vi.fn<Database["query"]>(async () => rows);
  const execute = vi.fn<Database["execute"]>(async () => undefined);
  return { query, execute };
}

it("finds the stored progress of a step", async () => {
  const db = database([ROW]);

  const progress = await new AgentPlanStepProgressRepository(db).find(
    "r1",
    "s1",
  );

  expect(progress).toEqual({
    runId: "r1",
    stepId: "s1",
    attemptId: "a1",
    todosJson: "[]",
    activity: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  expect(db.query.mock.calls[0]?.[1]).toEqual({ run_id: "r1", step_id: "s1" });
});

it("returns null before the first report", async () => {
  const progress = await new AgentPlanStepProgressRepository(database([])).find(
    "r1",
    "s1",
  );

  expect(progress).toBeNull();
});

it("lists the progress of every step of a run", async () => {
  const list = await new AgentPlanStepProgressRepository(
    database([ROW, [...ROW.slice(0, 4), "busy", ROW[5]]]),
  ).listForRun("r1");

  expect(list.map((entry) => entry.activity)).toEqual([null, "busy"]);
});

it("saves the progress with its named parameters", async () => {
  const db = database([]);

  await new AgentPlanStepProgressRepository(db).save({
    runId: "r1",
    stepId: "s1",
    attemptId: "a1",
    todosJson: "[1]",
    activity: "x",
    updatedAt: "t",
  });

  expect(db.execute.mock.calls[0]?.[1]).toEqual({
    run_id: "r1",
    step_id: "s1",
    attempt_id: "a1",
    todos_json: "[1]",
    activity: "x",
    updated_at: "t",
  });
});
