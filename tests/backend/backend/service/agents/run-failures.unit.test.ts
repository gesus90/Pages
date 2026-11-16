import { expect, it } from "vitest";

import {
  extractRunFailures,
  runStepResults,
  stepAttemptId,
  stepTimes,
  summarizeRunFailure,
} from "@/backend/service/agents/diagnosis/RunFailures";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

it("uses stored script, session and execution facts to identify an attempt and its times", () => {
  const step = partial<AgentPlanStepResult>({
    id: "work",
    script: { attemptId: "script", startedAt: "start", endedAt: "end" },
    session: { attemptId: "session", startedAt: "later", endedAt: "later-end" },
    execution: { attemptId: "execution" },
  });
  expect(stepTimes(step)).toEqual({ startedAt: "start", endedAt: "end" });
  expect(stepAttemptId(step)).toBe("session");
  expect(
    stepAttemptId(
      partial<AgentPlanStepResult>({ execution: { attemptId: "execution" } }),
    ),
  ).toBe("execution");
  expect(stepTimes(partial<AgentPlanStepResult>({}))).toEqual({
    startedAt: null,
    endedAt: null,
  });
});

it("orders failures from outer and loop steps without duplicating the failed loop", () => {
  const outer = partial<AgentPlanStepResult>({
    id: "outer",
    name: "Outer",
    status: "failed",
    error: "plan_access_denied",
    script: { attemptId: "a", endedAt: "2030-01-02" },
  });
  const member = partial<AgentPlanStepResult>({
    id: "member",
    name: "Member",
    status: "failed",
    error: "plan_script_timeout",
    session: { attemptId: "b", endedAt: "2030-01-01" },
  });
  const loop = partial<AgentPlanStepResult>({
    id: "loop",
    name: "Loop",
    status: "failed",
  });
  const run = partial<AgentPlanRun>({
    status: "failed",
    startedAt: "2029-12-31",
    steps: [outer, loop],
    loops: [{ id: "loop", iterations: [{ number: 2, nodes: [member] }] }],
  });
  const failures = extractRunFailures(run);
  expect(
    failures.map((failure) => [
      failure.stepId,
      failure.loopId,
      failure.iteration,
      failure.errorClass,
    ]),
  ).toEqual([
    ["member", "loop", 2, "timeout"],
    ["outer", null, null, "permission"],
  ]);
  expect(summarizeRunFailure(run, failures)).toMatchObject({
    failedStepId: "member",
    errorCode: "plan_script_timeout",
  });
  expect(runStepResults(run).map((step) => step.id)).toEqual(
    expect.arrayContaining(["outer", "loop", "member"]),
  );
});

it("summarizes interruption or control errors when no individual step failed", () => {
  const run = partial<AgentPlanRun>({
    status: "failed",
    steps: [],
    recovery: { state: "interrupted" },
    controlError: "plan_access_denied",
  });
  expect(summarizeRunFailure(run, [])).toMatchObject({
    failedStepId: null,
    errorCode: "plan_interrupted",
  });
  expect(
    summarizeRunFailure({ ...run, recovery: undefined }, []),
  ).toMatchObject({ errorClass: "permission" });
  expect(summarizeRunFailure({ ...run, status: "succeeded" }, [])).toBeNull();
});
