import { expect, it } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  readFailureSummaryRequest,
  readRunListRequest,
  readRunLogRequest,
  readRunTimelineRequest,
} from "@/backend/service/agents/diagnosis/AgentRunDiagnosisInput";
import { AGENT_RUN_DIAGNOSIS_LIMITS } from "@/definition/AgentRunDiagnosis";

it("applies list defaults and normalizes identifiers and time zones", () => {
  expect(readRunListRequest(null)).toMatchObject({
    projectId: null,
    from: null,
    to: null,
    limit: AGENT_RUN_DIAGNOSIS_LIMITS.runsDefault,
  });
  expect(
    readRunListRequest({
      projectId: " project ",
      from: "2030-01-01T01:00:00+01:00",
      limit: 1,
    }),
  ).toMatchObject({
    projectId: "project",
    from: "2030-01-01T00:00:00.000Z",
    limit: 1,
  });
  expect(readFailureSummaryRequest({})).toMatchObject({
    groupBy: "errorClass",
    limit: AGENT_RUN_DIAGNOSIS_LIMITS.failureGroupsDefault,
  });
  expect(
    readRunLogRequest({ runId: " run ", planId: "ignored" }),
  ).toMatchObject({
    runId: "run",
    level: "info",
    limit: AGENT_RUN_DIAGNOSIS_LIMITS.logsDefault,
  });
  expect(readRunTimelineRequest({ runId: "run", planId: "ignored" })).toBe(
    "run",
  );
});

it.each([
  [{ extra: true }, "unknown_parameter"],
  [{ limit: 0 }, "limit_out_of_range"],
  [{ limit: "1" }, "parameter_invalid"],
  [{ from: "invalid" }, "time_invalid"],
  [{ from: "2030-02-01", to: "2030-01-01" }, "time_range_reversed"],
  [{ projectId: " " }, "parameter_invalid"],
])("rejects invalid list request with reason %s", (input, reason) => {
  try {
    readRunListRequest(input);
    throw new Error("Expected rejection");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AgentOperationError);
    if (!(error instanceof AgentOperationError)) throw error;
    expect(error.code).toBe("INVALID_REQUEST");
    const details = error.details;
    expect(details && "reason" in details ? details.reason : undefined).toBe(
      reason,
    );
  }
});

it("rejects invalid log, timeline and summary requests", () => {
  expect(() => readRunLogRequest(null)).toThrow();
  expect(() => readRunTimelineRequest([])).toThrow();
  expect(() => readRunTimelineRequest({ runId: "", other: 1 })).toThrow();
  expect(() => readFailureSummaryRequest({ groupBy: "unknown" })).toThrow();
  expect(() =>
    readFailureSummaryRequest({ from: "2030-02-01", to: "2030-01-01" }),
  ).toThrow();
});
