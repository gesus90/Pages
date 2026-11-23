import { describe, expect, it } from "vitest";

import {
  readPlanFailureStop,
  readPlanProviderFailure,
  readPlanRetry,
} from "@/backend/agents/AgentPlanRetryInput";

const ATTEMPT = {
  attemptId: "attempt",
  sessionId: "session",
  endedAt: "2026-01-01T00:00:00.000Z",
  code: "provider_unavailable",
};

const WAITING = {
  state: "waiting",
  reason: "transient",
  nextAttemptAt: "2026-01-01T01:00:00.000Z",
  resetAt: null,
  attempts: [ATTEMPT],
};

describe("readPlanFailureStop", () => {
  const stop = {
    failureClass: "form",
    attempts: 2,
    maximumAttempts: 3,
    totalAttempts: 4,
  };

  it("returns a valid stop", () => {
    expect(readPlanFailureStop(stop)).toEqual(stop);
  });

  it.each([
    ["an unknown class", { ...stop, failureClass: "other" }],
    ["a zero attempt count", { ...stop, attempts: 0 }],
    ["an unknown field", { ...stop, extra: true }],
    ["a non-object", "stop"],
  ])("rejects %s", (description, input) => {
    expect(() => readPlanFailureStop(input)).toThrowError(
      expect.objectContaining({ code: "plan_invalid" }),
    );
  });
});

describe("readPlanProviderFailure", () => {
  it("returns a failure with and without a reset time", () => {
    const withReset = {
      code: "provider_quota_exhausted",
      resetAt: "2026-01-01T00:00:00.000Z",
    };
    expect(readPlanProviderFailure(withReset)).toEqual(withReset);
    expect(
      readPlanProviderFailure({ code: "provider_unreachable", resetAt: null }),
    ).toEqual({ code: "provider_unreachable", resetAt: null });
  });

  it("rejects an unknown code and a malformed reset time", () => {
    expect(() =>
      readPlanProviderFailure({ code: "weird", resetAt: null }),
    ).toThrowError(expect.objectContaining({ code: "plan_invalid" }));
    expect(() =>
      readPlanProviderFailure({
        code: "provider_unreachable",
        resetAt: "soon",
      }),
    ).toThrowError(expect.objectContaining({ code: "plan_invalid" }));
  });
});

describe("readPlanRetry", () => {
  it("returns a waiting record with a next attempt", () => {
    expect(readPlanRetry(WAITING)).toEqual(WAITING);
  });

  it("returns a finished record with optional detail", () => {
    const record = {
      policy: "provider",
      failureClass: "infrastructure",
      state: "blocked",
      reason: "exhausted",
      nextAttemptAt: null,
      resetAt: "2026-01-01T00:00:00.000Z",
      requiredResumeSessionId: "session",
      attempts: [{ ...ATTEMPT, failureClass: "open", issues: ["issue"] }],
    };
    expect(readPlanRetry(record)).toEqual(record);
  });

  it.each([
    [
      "a waiting record without a next attempt",
      { ...WAITING, nextAttemptAt: null },
    ],
    ["a running record with a next attempt", { ...WAITING, state: "running" }],
    ["an empty history", { ...WAITING, attempts: [] }],
    [
      "a too long history",
      { ...WAITING, attempts: Array.from({ length: 12 }, () => ATTEMPT) },
    ],
    ["an unknown reason", { ...WAITING, reason: "other" }],
    ["a non-object", null],
  ])("rejects %s", (description, input) => {
    expect(() => readPlanRetry(input)).toThrowError(
      expect.objectContaining({ code: "plan_invalid" }),
    );
  });
});
