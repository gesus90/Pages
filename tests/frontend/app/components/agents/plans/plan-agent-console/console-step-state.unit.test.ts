import { expect, it } from "vitest";

import {
  consoleStepState,
  currentEnding,
  earlierAttempts,
  hasSessionEnded,
  infrastructureRestarts,
} from "@/app/components/agents/plans/plan-agent-console/console-step-state";

import { runStep, syntheticSession } from "../../page72-run-fixture";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type {
  AgentPlanRetry,
  AgentPlanRetryAttempt,
} from "@/definition/AgentPlanRetry";

function failure(
  overrides: Partial<AgentPlanRetryAttempt> = {},
): AgentPlanRetryAttempt {
  return {
    attemptId: "a1",
    sessionId: "s1",
    endedAt: "2026-10-26T10:00:00.000Z",
    code: "plan_acp_session_failed",
    failureClass: "infrastructure",
    ...overrides,
  };
}

function retry(overrides: Partial<AgentPlanRetry> = {}): AgentPlanRetry {
  return {
    state: "waiting",
    reason: "transient",
    nextAttemptAt: "2026-10-26T10:01:00.000Z",
    resetAt: null,
    attempts: [failure()],
    ...overrides,
  };
}

function step(
  retryRecord: AgentPlanRetry | undefined,
  overrides: Partial<AgentPlanStepResult> = {},
  session: Record<string, unknown> = {},
): AgentPlanStepResult {
  return runStep("node", {
    status: "running",
    session: { ...syntheticSession(), retry: retryRecord, ...session },
    ...overrides,
  });
}

it("counts only infrastructure failures as restarts, at most the budget", () => {
  expect(infrastructureRestarts(runStep("node"))).toBe(0);
  expect(
    infrastructureRestarts(
      step(
        retry({
          attempts: [failure(), failure({ failureClass: "form" }), failure()],
        }),
      ),
    ),
  ).toBe(2);
  expect(
    infrastructureRestarts(
      step(retry({ attempts: Array.from({ length: 6 }, () => failure()) })),
    ),
  ).toBe(3);
});

it("lists earlier attempts with a resume that follows the growing delays of infrastructure failures", () => {
  const record = retry({
    attempts: [
      failure({ attemptId: "a1", sessionId: "s1" }),
      failure({ attemptId: "a2", sessionId: "s2" }),
      failure({ attemptId: "a3", sessionId: "s3" }),
    ],
  });
  const earlier = earlierAttempts(
    step(record, {}, { sessionId: "s3", attemptId: "a3" }),
    "a3",
  );
  expect(earlier.map((entry) => entry.attemptId)).toEqual(["a1", "a2"]);
  expect(earlier.map((entry) => entry.number)).toEqual([1, 2]);
  expect(earlier[0]?.endedAt).toBe("2026-10-26T10:00:00.000Z");
  expect(earlier[0]?.ending).toEqual({
    kind: "aborted",
    reason: "plan_acp_session_failed",
    resume: {
      delaySeconds: 10,
      restart: 1,
      limit: 3,
      isSameSession: false,
      isRepair: false,
    },
  });
  expect(earlier[1]?.ending).toMatchObject({
    resume: { delaySeconds: 60, restart: 2, isSameSession: false },
  });
});

it("marks a resume in the same session when the next attempt keeps the session and reads the last one from the step", () => {
  const record = retry({
    attempts: [failure({ attemptId: "a1", sessionId: "s1" })],
  });
  const same = earlierAttempts(
    step(record, {}, { sessionId: "s1", attemptId: "now" }),
    "now",
  );
  expect(same[0]?.ending).toMatchObject({
    resume: { isSameSession: true },
  });
  const unknown = earlierAttempts(
    step(
      retry({ attempts: [failure({ sessionId: null })] }),
      {},
      { sessionId: null, attemptId: "now" },
    ),
    "now",
  );
  expect(unknown[0]?.ending).toMatchObject({
    resume: { isSameSession: false },
  });
});

it("plans repair rounds for other classes, defaults old records to open and ends the resume once the limit passed", () => {
  const earlier = earlierAttempts(
    step(
      retry({
        attempts: [
          failure({ attemptId: "a1", failureClass: "form", code: "bad" }),
          failure({ attemptId: "a2", failureClass: undefined, code: "odd" }),
          failure({ attemptId: "a3", failureClass: "harm", code: "harm" }),
        ],
      }),
      {},
      { sessionId: null, attemptId: "now" },
    ),
    "now",
  );
  expect(earlier[0]?.ending).toMatchObject({
    reason: "bad",
    resume: { delaySeconds: 0, restart: 1, limit: 2, isRepair: true },
  });
  expect(earlier[1]?.ending).toMatchObject({
    reason: "odd",
    resume: { limit: 2, isRepair: true },
  });
  expect(earlier[2]?.ending).toEqual({
    kind: "aborted",
    reason: "harm",
    resume: null,
  });
});

it("skips attempts without an ID and the current one, and has none without a retry record", () => {
  expect(earlierAttempts(runStep("node"), "now")).toEqual([]);
  expect(
    earlierAttempts(
      step(
        retry({
          attempts: [
            failure({ attemptId: null }),
            failure({ attemptId: "now" }),
          ],
        }),
      ),
      "now",
    ),
  ).toEqual([]);
});

it("ends the current attempt as aborted with the planned delay while the retry waits", () => {
  const record = retry({
    attempts: [failure({ attemptId: "now", sessionId: "s1" })],
    nextAttemptAt: "2026-10-26T10:00:45.000Z",
    requiredResumeSessionId: "s1",
  });
  expect(currentEnding(step(record, {}, { attemptId: "now" }))).toEqual({
    kind: "aborted",
    reason: "plan_acp_session_failed",
    resume: {
      delaySeconds: 45,
      restart: 1,
      limit: 3,
      isSameSession: true,
      isRepair: false,
    },
  });
  // Without a readable pair of times the default delay of the class stays.
  const unreadable = retry({
    attempts: [failure({ attemptId: "now", endedAt: "never" })],
    nextAttemptAt: null,
  });
  expect(
    currentEnding(step(unreadable, {}, { attemptId: "now" })),
  ).toMatchObject({
    resume: { delaySeconds: 10, isSameSession: false },
  });
});

it("ends the current attempt by the retry state: stopped when cancelled, blocked with the last code and the attempt count", () => {
  const attempts = [
    failure({ attemptId: "a1", code: "first" }),
    failure({ attemptId: "now", code: "last" }),
  ];
  expect(
    currentEnding(
      step(retry({ state: "cancelled", attempts }), {}, { attemptId: "now" }),
    ),
  ).toEqual({ kind: "stopped" });
  expect(
    currentEnding(
      step(retry({ state: "blocked", attempts }), {}, { attemptId: "now" }),
    ),
  ).toEqual({ kind: "blocked", reason: "last", attempts: 2 });
  // A running retry or an attempt the retry does not know gives no ending of its own.
  expect(
    currentEnding(
      step(retry({ state: "running", attempts }), {}, { attemptId: "now" }),
    ),
  ).toBeNull();
  expect(
    currentEnding(
      step(retry({ state: "blocked", attempts }), {}, { attemptId: "other" }),
    ),
  ).toBeNull();
});

it("ends a settled node by its status: succeeded with the done todos, stopped, or blocked with its error", () => {
  expect(currentEnding(runStep("node", { status: "succeeded" }))).toEqual({
    kind: "succeeded",
    done: 0,
    total: 0,
  });
  expect(
    currentEnding(
      runStep("node", { status: "succeeded", session: syntheticSession() }),
    ),
  ).toEqual({ kind: "succeeded", done: 1, total: 3 });
  expect(currentEnding(runStep("node", { status: "cancelled" }))).toEqual({
    kind: "stopped",
  });
  expect(
    currentEnding(runStep("node", { status: "failed", error: "broke" })),
  ).toEqual({ kind: "blocked", reason: "broke", attempts: 1 });
  expect(currentEnding(runStep("node", { status: "failed" }))).toEqual({
    kind: "blocked",
    reason: "plan_step_failed",
    attempts: 1,
  });
  expect(
    currentEnding(
      step(
        retry({ state: "running", attempts: [failure(), failure()] }),
        { status: "failed", error: "broke" },
        { attemptId: "x" },
      ),
    ),
  ).toEqual({ kind: "blocked", reason: "broke", attempts: 2 });
  expect(currentEnding(runStep("node", { status: "running" }))).toBeNull();
});

it("tells the state pill: a countdown while waiting, the end states, else the session state", () => {
  const now = Date.parse("2026-10-26T10:00:30.000Z");
  expect(consoleStepState(step(retry()), "running", now)).toEqual({
    kind: "resume",
    seconds: 30,
  });
  expect(
    consoleStepState(step(retry({ nextAttemptAt: null })), null, now),
  ).toEqual({ kind: "resume", seconds: 0 });
  expect(
    consoleStepState(
      step(retry({ nextAttemptAt: "2026-10-26T09:00:00.000Z" })),
      null,
      now,
    ),
  ).toEqual({ kind: "resume", seconds: 0 });
  expect(
    consoleStepState(runStep("node", { status: "succeeded" }), "ended", now),
  ).toEqual({ kind: "succeeded" });
  expect(
    consoleStepState(runStep("node", { status: "cancelled" }), null, now),
  ).toEqual({ kind: "stopped" });
  expect(
    consoleStepState(runStep("node", { status: "failed" }), null, now),
  ).toEqual({ kind: "failed" });
  expect(
    consoleStepState(
      runStep("node", { status: "failed", isBlocked: true }),
      null,
      now,
    ),
  ).toEqual({ kind: "blocked" });
  expect(
    consoleStepState(
      step(retry({ state: "blocked" }), { status: "failed" }),
      null,
      now,
    ),
  ).toEqual({ kind: "blocked" });
  expect(
    consoleStepState(runStep("node", { status: "running" }), "idle", now),
  ).toEqual({ kind: "session", state: "idle" });
  expect(
    consoleStepState(runStep("node", { status: "running" }), null, now),
  ).toBeNull();
});

it("says the session ended for every settled status and for none still alive", () => {
  for (const status of ["succeeded", "failed", "cancelled", "skipped"] as const)
    expect(hasSessionEnded(runStep("node", { status }))).toBe(true);
  for (const status of ["running", "waiting"] as const)
    expect(hasSessionEnded(runStep("node", { status }))).toBe(false);
});

/** A stored attempt of an older record that lacks the given fields. */
function legacyAttempt(
  missing: "code" | "endedAt",
  overrides: Partial<AgentPlanRetryAttempt> = {},
): AgentPlanRetryAttempt {
  return {
    ...failure(overrides),
    [missing]: undefined,
  };
}

it("keeps the default delay when a waiting attempt has no stored end time", () => {
  const record = retry({
    attempts: [legacyAttempt("endedAt", { attemptId: "now" })],
    nextAttemptAt: "2026-10-26T10:00:45.000Z",
  });
  expect(currentEnding(step(record, {}, { attemptId: "now" }))).toMatchObject({
    kind: "aborted",
    resume: { delaySeconds: 10, restart: 1 },
  });
});

it("names a failure of an older record without a code as the general step failure", () => {
  const attempts = [legacyAttempt("code", { attemptId: "now" })];
  expect(
    currentEnding(
      step(retry({ state: "blocked", attempts }), {}, { attemptId: "now" }),
    ),
  ).toEqual({ kind: "blocked", reason: "plan_step_failed", attempts: 1 });
  expect(
    earlierAttempts(
      step(retry({ attempts }), {}, { attemptId: "other" }),
      "other",
    )[0]?.ending,
  ).toMatchObject({ kind: "aborted", reason: "plan_step_failed" });
});
