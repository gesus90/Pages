import { describe, expect, it } from "vitest";

import {
  readPlanContinuation,
  readPlanPauseBoundary,
} from "@/backend/agents/AgentPlanContinuationInput";
import { AgentError } from "@/backend/error/AgentErrors";

const BOUNDARY = {
  pausedAt: " t ",
  completedStepIds: ["a"],
  pendingStepIds: [],
  frontierStepIds: ["b", "c"],
};

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof AgentError ? error.code : undefined;
  }
  return undefined;
}

describe("readPlanPauseBoundary", () => {
  it("invents nothing for an old record", () => {
    expect(readPlanPauseBoundary(undefined)).toEqual({});
  });

  it("reads a boundary", () => {
    expect(readPlanPauseBoundary(BOUNDARY)).toEqual({
      pauseBoundary: { ...BOUNDARY, pausedAt: "t" },
    });
  });

  it("rejects malformed identifier lists", () => {
    expect(
      codeOf(() =>
        readPlanPauseBoundary({ ...BOUNDARY, completedStepIds: "a" }),
      ),
    ).toBe("plan_invalid");
    expect(
      codeOf(() =>
        readPlanPauseBoundary({
          ...BOUNDARY,
          pendingStepIds: Array.from({ length: 101 }, () => "a"),
        }),
      ),
    ).toBe("plan_invalid");
    expect(
      codeOf(() =>
        readPlanPauseBoundary({ ...BOUNDARY, frontierStepIds: [1] }),
      ),
    ).toBe("plan_invalid");
  });
});

describe("readPlanContinuation", () => {
  it("returns nothing when absent and the public marker otherwise", () => {
    expect(readPlanContinuation(undefined)).toEqual({});
    expect(
      readPlanContinuation({
        version: 1,
        planRevision: 2,
        adoptedAt: "t",
        snapshot: "private",
      }),
    ).toEqual({
      continuation: { version: 1, planRevision: 2, adoptedAt: "t" },
    });
  });

  it("rejects malformed markers", () => {
    const base = { version: 1, planRevision: 1, adoptedAt: "t" };
    for (const input of [
      { ...base, version: "1" },
      { ...base, version: 0 },
      { ...base, version: 1.5 },
      { ...base, planRevision: "1" },
      { ...base, planRevision: 0 },
      { ...base, planRevision: 1.5 },
      { ...base, adoptedAt: "" },
    ])
      expect(codeOf(() => readPlanContinuation(input))).toBe("plan_invalid");
  });
});
