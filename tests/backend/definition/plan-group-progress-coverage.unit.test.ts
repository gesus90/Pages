import { expect, it } from "vitest";

import { planGroupProgress } from "@/definition/AgentPlanGroupProgress";

import {
  progressRun,
  progressSession,
  progressStep,
} from "../backend/service/agents/page162-progress-fixture";
import { agent, groupOf } from "./plan-fixtures";

const GROUP = groupOf("group", [agent("first"), agent("second")]);

it("counts successful members and derives control states", () => {
  expect(planGroupProgress(GROUP, null)).toMatchObject({
    completed: 0,
    total: 2,
    state: "ready",
  });
  const run = progressRun([
    progressStep({ id: "first", status: "succeeded" }),
    progressStep({ id: "second", status: "waiting" }),
  ]);
  expect(planGroupProgress(GROUP, run)).toMatchObject({
    completed: 1,
    total: 2,
    state: "ready",
  });
  expect(planGroupProgress(GROUP, { ...run, status: "pausing" }).state).toBe(
    "pausing",
  );
  expect(planGroupProgress(GROUP, { ...run, status: "stopping" }).state).toBe(
    "stopping",
  );
  expect(planGroupProgress(GROUP, { ...run, status: "paused" }).state).toBe(
    "paused",
  );
});

it("prioritizes failure and blocked members over active work", () => {
  const running = progressStep({ id: "first", status: "running" });
  const failed = progressStep({
    id: "second",
    status: "failed",
    error: "failure",
  });
  expect(
    planGroupProgress(GROUP, progressRun([running, failed])),
  ).toMatchObject({ state: "failed", error: "failure" });
  expect(
    planGroupProgress(
      GROUP,
      progressRun([
        running,
        { ...failed, status: "waiting", error: null, isBlocked: true },
      ]),
    ).state,
  ).toBe("blocked");
  expect(
    planGroupProgress(GROUP, progressRun([running]), "inaccessible"),
  ).toMatchObject({ state: "unavailable", total: null, error: "inaccessible" });
});

it("distinguishes skipped work, completed work and lost sessions", () => {
  const skipped = progressStep({ id: "first", status: "skipped" });
  expect(planGroupProgress(GROUP, progressRun([skipped])).state).toBe(
    "skipped",
  );
  expect(
    planGroupProgress(GROUP, progressRun([{ ...skipped, status: "succeeded" }]))
      .state,
  ).toBe("completed");
  const session = {
    ...progressSession([]),
    events: ["resource session retired: synthetic"],
  };
  const run = progressRun([
    progressStep({ id: "first", status: "waiting", session }),
  ]);
  expect(planGroupProgress(GROUP, run)).toMatchObject({
    state: "blocked",
    error: "plan_group_session_lost",
  });
  expect(
    planGroupProgress(GROUP, {
      ...run,
      stopRequested: true,
      status: "stopping",
    }).state,
  ).toBe("stopping");
});
