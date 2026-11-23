import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { AgentPlanStepReportRepository } from "./AgentPlanStepReportRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

const SLOT = {
  runId: "r1",
  sessionScopeId: "n1",
  stepId: "s1",
  attemptId: "a1",
  termsJson: "{}",
};

function database(rows: DatabaseValue[][]): {
  query: Mock<Database["query"]>;
  execute: Mock<Database["execute"]>;
} {
  const query = vi.fn<Database["query"]>(async () => rows);
  const execute = vi.fn<Database["execute"]>(async () => undefined);
  return { query, execute };
}

it("opens the slot of a turn", async () => {
  const db = database([]);

  await new AgentPlanStepReportRepository(db).open(SLOT);

  expect(db.execute.mock.calls[0]?.[1]).toEqual({
    run_id: "r1",
    session_scope_id: "n1",
    step_id: "s1",
    attempt_id: "a1",
    terms_json: "{}",
  });
});

it("finds the open slot with its report", async () => {
  const db = database([["s1", "a1", "{}", "report"]]);

  const found = await new AgentPlanStepReportRepository(db).find({
    runId: "r1",
    sessionScopeId: "n1",
  });

  expect(found).toEqual({ ...SLOT, reportJson: "report" });
});

it("finds no slot when none is open", async () => {
  const found = await new AgentPlanStepReportRepository(database([])).find({
    runId: "r1",
    sessionScopeId: "n1",
  });

  expect(found).toBeNull();
});

it("tells whether the attempt still held the slot on save", async () => {
  const held = new AgentPlanStepReportRepository(database([["a1"]]));
  const lost = new AgentPlanStepReportRepository(database([]));

  expect(await held.save(SLOT, "{}")).toBe(true);
  expect(await lost.save(SLOT, "{}")).toBe(false);
});

it("returns the report held when closing a slot", async () => {
  const db = database([["report"]]);

  const report = await new AgentPlanStepReportRepository(db).close(SLOT);

  expect(report).toBe("report");
  expect(db.query.mock.calls[0]?.[1]).toMatchObject({ attempt_id: "a1" });
});

it("returns null when closing finds no slot of the attempt", async () => {
  const report = await new AgentPlanStepReportRepository(database([])).close(
    SLOT,
  );

  expect(report).toBeNull();
});
