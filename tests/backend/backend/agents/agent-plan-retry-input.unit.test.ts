import { expect, it } from "vitest";

import {
  readPlanProviderFailure,
  readPlanRetry,
} from "@/backend/agents/AgentPlanRetryInput";

import { agentErrorCode } from "./agent-error-code";

const ATTEMPT = {
  attemptId: "a",
  sessionId: null,
  endedAt: "2026-10-20T10:00:00Z",
  code: "provider_unavailable",
};

it("reads a provider failure with or without a reset time", () => {
  expect(
    readPlanProviderFailure({
      code: "provider_quota_exhausted",
      resetAt: "2026-10-21T00:00:00Z",
    }),
  ).toEqual({
    code: "provider_quota_exhausted",
    resetAt: "2026-10-21T00:00:00Z",
  });
  expect(agentErrorCode(() => readPlanProviderFailure({ code: "other" }))).toBe(
    "plan_invalid",
  );
});

it("reads a waiting retry only with its next attempt time", () => {
  const waiting = {
    state: "waiting",
    reason: "transient",
    nextAttemptAt: "2026-10-20T10:05:00Z",
    resetAt: null,
    attempts: [ATTEMPT],
  };
  expect(readPlanRetry(waiting)).toEqual(waiting);
  expect(
    agentErrorCode(() => readPlanRetry({ ...waiting, nextAttemptAt: null })),
  ).toBe("plan_invalid");
});

it("reads a finished retry only without a next attempt time", () => {
  const completed = {
    state: "completed",
    reason: "exhausted",
    nextAttemptAt: null,
    resetAt: null,
    attempts: [ATTEMPT],
  };
  expect(readPlanRetry(completed)).toEqual(completed);
  expect(
    agentErrorCode(() =>
      readPlanRetry({ ...completed, nextAttemptAt: "2026-10-20T10:05:00Z" }),
    ),
  ).toBe("plan_invalid");
  expect(
    agentErrorCode(() => readPlanRetry({ ...completed, attempts: [] })),
  ).toBe("plan_invalid");
});
