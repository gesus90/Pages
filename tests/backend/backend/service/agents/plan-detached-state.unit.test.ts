import { expect, it } from "vitest";

import {
  detachedStopRun,
  interruptedPlanRun,
  isCompletedPlanRun,
  isWorkDoneCloseoutOpen,
  settleDetachedRun,
} from "@/backend/service/agents/AgentPlanRunState";

import {
  progressRun,
  progressSession,
  progressStep,
} from "./page162-progress-fixture";

it("restores unstarted work after interruption and marks active work interrupted", () => {
  const run = progressRun([
    progressStep({
      id: "unstarted",
      status: "cancelled",
      cancellation: "not_started",
    }),
    progressStep({ id: "active", status: "running" }),
    progressStep({ id: "done", status: "succeeded" }),
  ]);
  expect(interruptedPlanRun(run)).toMatchObject({
    status: "failed",
    recovery: { state: "interrupted", requiresReconciliation: true },
    steps: [
      { id: "unstarted", status: "waiting", cancellation: "none", error: null },
      { id: "active", status: "failed", error: "plan_interrupted" },
      { id: "done", status: "succeeded" },
    ],
  });
});

it("ends a detached stop after cancelling waiting work and failing local running work", () => {
  const run = progressRun([
    progressStep({ id: "waiting", status: "waiting", isBlocked: true }),
    progressStep({ id: "local", status: "running" }),
  ]);
  expect(detachedStopRun(run)).toMatchObject({
    status: "cancelled",
    stopRequested: true,
    steps: [
      {
        id: "waiting",
        status: "cancelled",
        cancellation: "not_started",
        isBlocked: false,
      },
      {
        id: "local",
        status: "failed",
        cancellation: "requested",
        error: "plan_interrupted",
      },
    ],
  });
});

it("requires completed results and confirmed cleanup before settling a detached run", () => {
  const completed = progressRun([progressStep({ status: "succeeded" })]);
  expect(isCompletedPlanRun(completed)).toBe(true);
  expect(settleDetachedRun(completed).status).toBe("succeeded");
  expect(isCompletedPlanRun({ ...completed, stopRequested: true })).toBe(false);
  expect(isCompletedPlanRun({ ...completed, steps: [] })).toBe(false);
  const pending = {
    ...completed,
    steps: [
      progressStep({ status: "succeeded", session: progressSession([]) }),
    ],
  };
  expect(isCompletedPlanRun(pending)).toBe(false);
  expect(settleDetachedRun(pending)).toMatchObject({
    status: "failed",
    recovery: { state: "interrupted" },
  });
  const running = progressRun();
  expect(settleDetachedRun(running)).toBe(running);
});

it("recognizes completed work held behind a failed closeout", () => {
  const run = progressRun([
    progressStep({ id: "work", status: "succeeded" }),
    progressStep({ id: "close", status: "failed", role: "closeout" }),
    progressStep({
      id: "after",
      status: "waiting",
      isBlocked: true,
      blockedByStepId: "close",
    }),
  ]);
  expect(isWorkDoneCloseoutOpen(run)).toBe(true);
  expect(settleDetachedRun(run).status).toBe("work_done_closeout_open");
  expect(isWorkDoneCloseoutOpen({ ...run, stopRequested: true })).toBe(false);
  expect(
    isWorkDoneCloseoutOpen({
      ...run,
      steps: [progressStep({ status: "failed" })],
    }),
  ).toBe(false);
});
