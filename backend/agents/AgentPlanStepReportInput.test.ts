import { describe, expect, it } from "vitest";

import {
  planStepReportCallSchema,
  readPlanStepReport,
} from "@/backend/agents/AgentPlanStepReportInput";

describe("planStepReportCallSchema", () => {
  it("applies defaults and trims texts", () => {
    const parsed = planStepReportCallSchema.parse({
      status: "done",
      message: "  Finished  ",
    });

    expect(parsed).toEqual({
      status: "done",
      message: "Finished",
      todos: [],
      criteria: [],
      decisions: [],
      summary: "",
    });
  });

  it("accepts identifiers and full lists", () => {
    const parsed = planStepReportCallSchema.parse({
      status: "blocked",
      message: "Stuck",
      todos: [{ id: "t1", status: "open" }],
      criteria: [{ id: "c1", met: true, evidence: "tests" }],
      decisions: ["Use X"],
      summary: "Short",
      runId: "run",
      stepId: "step",
    });

    expect(parsed.runId).toBe("run");
    expect(parsed.todos).toHaveLength(1);
  });

  it("rejects an empty message and unknown fields", () => {
    expect(
      planStepReportCallSchema.safeParse({ status: "done", message: " " })
        .success,
    ).toBe(false);
    expect(
      planStepReportCallSchema.safeParse({
        status: "done",
        message: "x",
        extra: 1,
      }).success,
    ).toBe(false);
  });
});

describe("readPlanStepReport", () => {
  it("reads a stored report", () => {
    expect(readPlanStepReport({ status: "done", message: "ok" }).todos).toEqual(
      [],
    );
  });

  it("throws for a damaged row", () => {
    expect(() => readPlanStepReport({ status: "other" })).toThrow();
    expect(() => readPlanStepReport(null)).toThrow();
  });
});
