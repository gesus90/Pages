import { describe, expect, it } from "vitest";

import { readCleanupFailureRecord } from "@/backend/agents/AgentPlanCleanupFailureInput";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

const RECORD = {
  id: "7f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f",
  createdAt: "2026-01-01T00:00:00.000Z",
  planId: "plan",
  runId: "run",
  planRevision: 1,
  recoveryRevision: 0,
  action: "release",
  attemptId: null,
  stepId: "step",
  kind: "loop",
  reason: "lease_too_recent",
};

describe("readCleanupFailureRecord", () => {
  it("keeps only the allowlisted fields", () => {
    expect(readCleanupFailureRecord({ ...RECORD, secret: "x" })).toEqual(
      RECORD,
    );
    const attemptId = "8f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";
    expect(readCleanupFailureRecord({ ...RECORD, attemptId }).attemptId).toBe(
      attemptId,
    );
  });

  it("refuses a malformed failure or malformed metadata", () => {
    for (const input of [
      null,
      { ...RECORD, kind: "unknown" },
      { ...RECORD, planRevision: 0 },
      { ...RECORD, id: "not-a-uuid" },
    ])
      expect(() => readCleanupFailureRecord(input)).toThrow(
        AgentPlanRecoveryError,
      );
    expect(() => readCleanupFailureRecord(null)).toThrow(
      expect.objectContaining({ code: "diagnostic_unavailable" }),
    );
  });
});
