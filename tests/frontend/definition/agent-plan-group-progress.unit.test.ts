import { describe, expect, it } from "vitest";

import {
  planGroupProgress,
  planGroupRunMembers,
} from "@/definition/AgentPlanGroupProgress";

import {
  runStep,
  syntheticRun,
} from "../app/components/agents/page72-run-fixture";
import { agent, groupOf } from "./plan-fixtures";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanStepExecution } from "@/definition/AgentPlanExecution";

const group = groupOf("frame", [agent("first"), agent("second")]);

function runOf(
  steps: readonly AgentPlanStepResult[],
  overrides: Partial<AgentPlanRun> = {},
): AgentPlanRun {
  return { ...syntheticRun(), steps, ...overrides };
}

function member(
  id: string,
  overrides: Partial<AgentPlanStepResult> = {},
): AgentPlanStepResult {
  return runStep(id, { groupId: "frame", ...overrides });
}

function sessionOf(
  overrides: Partial<NonNullable<AgentPlanStepResult["session"]>>,
): NonNullable<AgentPlanStepResult["session"]> {
  const session = syntheticRun().steps[1]?.session;
  if (!session) throw new Error("The synthetic run has a session.");
  return { ...session, ...overrides };
}

const RETIRED = ["resource session retired: lost"];

function executionOf(runId: string): AgentPlanStepExecution {
  return {
    schemaVersion: 1,
    planId: "plan",
    runId,
    stepId: "first",
    attemptId: "00000000-0000-4000-8000-000000000001",
    planRevision: 1,
    target: { kind: "local" },
    workspace: { id: "workspace", path: "/srv", revision: 1 },
    modelAccess: {
      connectionId: null,
      connectionName: "",
      provider: "api",
      model: "model",
      reasoningEffort: null,
    },
  };
}

describe("the members of a group in a run", () => {
  it("prefers the steps the run linked to the group over the current member list", () => {
    const linked = member("frozen");
    const run = runOf([linked, runStep("first"), runStep("other")]);
    expect(planGroupRunMembers(group, run)).toEqual([linked]);
  });

  it("falls back to the steps named like the saved members when nothing is linked", () => {
    const first = runStep("first");
    const run = runOf([first, runStep("outside"), runStep("second")]);
    expect(planGroupRunMembers(group, run).map((step) => step.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("has no members when the run knows neither link nor id", () => {
    expect(planGroupProgress(group, runOf([runStep("outside")]))).toEqual({
      completed: 0,
      total: null,
      state: "unavailable",
      error: null,
    });
  });
});

describe("progress without a run", () => {
  it("counts the saved members as the total and waits ready", () => {
    expect(planGroupProgress(group, null)).toEqual({
      completed: 0,
      total: 2,
      state: "ready",
      error: null,
    });
  });

  it("makes a load error unavailable, with no total and no progress", () => {
    expect(planGroupProgress(group, null, "plan_group_failed")).toEqual({
      completed: 0,
      total: null,
      state: "unavailable",
      error: "plan_group_failed",
    });
  });

  it("lets a load error win over the progress of a run", () => {
    const run = runOf([member("first", { status: "succeeded" })]);
    expect(planGroupProgress(group, run, "denied")).toEqual({
      completed: 0,
      total: null,
      state: "unavailable",
      error: "denied",
    });
  });
});

describe("progress of a run", () => {
  it("counts successful members and shows a still waiting group as ready", () => {
    const run = runOf([
      member("first", { status: "succeeded" }),
      member("second"),
    ]);
    expect(planGroupProgress(group, run)).toEqual({
      completed: 1,
      total: 2,
      state: "ready",
      error: null,
    });
  });

  it("is unknown, not invented, when a step appears twice", () => {
    const run = runOf([
      member("first", { status: "succeeded" }),
      member("first", { status: "succeeded" }),
    ]);
    expect(planGroupProgress(group, run)).toMatchObject({
      completed: 2,
      total: null,
      state: "unavailable",
    });
  });

  it("completes when every member succeeded or was skipped", () => {
    const run = runOf([
      member("first", { status: "succeeded" }),
      member("second", { status: "skipped" }),
    ]);
    expect(planGroupProgress(group, run)).toMatchObject({
      completed: 1,
      state: "completed",
    });
  });

  it("is skipped, not failed, when every member lies behind an untaken branch", () => {
    const run = runOf([
      member("first", { status: "skipped" }),
      member("second", { status: "skipped" }),
    ]);
    expect(planGroupProgress(group, run)).toEqual({
      completed: 0,
      total: 2,
      state: "skipped",
      error: null,
    });
  });
});

describe("progress of a failed or blocked group", () => {
  it("shows the first member error with a failed group", () => {
    const run = runOf([
      member("first", { status: "succeeded" }),
      member("second", { status: "failed", error: "plan_step_failed" }),
    ]);
    expect(planGroupProgress(group, run)).toEqual({
      completed: 1,
      total: 2,
      state: "failed",
      error: "plan_step_failed",
    });
  });

  it("fails a group whose member could not close its session", () => {
    const run = runOf([
      member("first", {
        status: "succeeded",
        session: sessionOf({ closeout: "failed" }),
      }),
      member("second", { status: "succeeded" }),
    ]);
    expect(planGroupProgress(group, run)).toMatchObject({
      completed: 1,
      state: "failed",
    });
  });

  it("does not count a success with a technical failure code", () => {
    const run = runOf([
      member("first", {
        status: "succeeded",
        session: sessionOf({ resultCode: -1 }),
      }),
      member("second", { status: "succeeded" }),
    ]);
    expect(planGroupProgress(group, run)).toMatchObject({
      completed: 1,
      state: "failed",
    });
  });

  it("lets a failure win over a blocked input", () => {
    const run = runOf([
      member("first", { isBlocked: true }),
      member("second", { status: "failed" }),
    ]);
    expect(planGroupProgress(group, run).state).toBe("failed");
  });

  it("blocks a group with a member that waits for blocked input", () => {
    const run = runOf([
      member("first", { status: "running" }),
      member("second", { isBlocked: true }),
    ]);
    expect(planGroupProgress(group, run).state).toBe("blocked");
  });

  it("blocks a run whose control failed once its members have no unfinished failure", () => {
    const run = runOf(
      [member("first", { status: "succeeded" }), member("second")],
      { controlError: "plan_step_failed" },
    );
    expect(planGroupProgress(group, run).state).toBe("blocked");
  });
});

describe("progress of a group with a failed control", () => {
  it("treats succeeded and cancelled members as stopped", () => {
    const run = runOf([
      member("first", { status: "succeeded" }),
      member("second", { status: "cancelled" }),
    ]);
    expect(planGroupProgress(group, run).state).toBe("stopped");
  });
});

describe("a lost resource session", () => {
  const lost = (
    overrides: Partial<AgentPlanStepResult> = {},
  ): AgentPlanStepResult =>
    member("first", {
      status: "succeeded",
      session: sessionOf({ events: RETIRED }),
      ...overrides,
    });

  it("blocks the unfinished group and names the loss", () => {
    const run = runOf([lost(), member("second", { status: "running" })]);
    expect(planGroupProgress(group, run)).toEqual({
      completed: 1,
      total: 2,
      state: "blocked",
      error: "plan_group_session_lost",
    });
  });

  it("stays harmless when every member finished", () => {
    const run = runOf([lost(), member("second", { status: "succeeded" })]);
    expect(planGroupProgress(group, run)).toMatchObject({
      state: "completed",
      error: null,
    });
  });

  it("does not report a loss for a run that is being stopped", () => {
    const run = runOf([lost(), member("second", { status: "running" })], {
      stopRequested: true,
    });
    expect(planGroupProgress(group, run)).toMatchObject({
      state: "running",
      error: null,
    });
  });

  it("ignores a member the run took over from an earlier run by its origin", () => {
    const run = runOf([lost(), member("second", { status: "running" })], {
      origin: {
        kind: "resume",
        runId: "earlier",
        mode: null,
        checkpointVersion: null,
        reusedStepIds: ["first"],
        retriedStepIds: [],
        reviewedStepIds: [],
        requestedAt: "2026-10-15T10:00:00.000Z",
      },
    });
    expect(planGroupProgress(group, run)).toMatchObject({
      state: "running",
      error: null,
    });
  });

  it("ignores a member whose execution belongs to another run", () => {
    const run = runOf(
      [
        lost({ execution: executionOf("earlier") }),
        member("second", { status: "running" }),
      ],
      { id: "current" },
    );
    expect(planGroupProgress(group, run)).toMatchObject({
      state: "running",
      error: null,
    });
  });

  it("counts a member whose execution belongs to this run", () => {
    const run = runOf(
      [
        lost({ execution: executionOf("current") }),
        member("second", { status: "running" }),
      ],
      { id: "current" },
    );
    expect(planGroupProgress(group, run).state).toBe("blocked");
  });
});

describe("control state of an unfinished group", () => {
  const unfinished = (
    run: Partial<AgentPlanRun>,
    second: AgentPlanStepResult["status"] = "waiting",
  ): AgentPlanRun =>
    runOf(
      [
        member("first", { status: "succeeded" }),
        member("second", { status: second }),
      ],
      run,
    );

  it.each([
    {
      name: "stopping",
      run: { status: "stopping" },
      second: "waiting",
      expected: "stopping",
    },
    {
      name: "pausing",
      run: { status: "pausing" },
      second: "waiting",
      expected: "pausing",
    },
    {
      name: "cancelled",
      run: { status: "cancelled" },
      second: "waiting",
      expected: "stopped",
    },
    {
      name: "failed",
      run: { status: "failed" },
      second: "waiting",
      expected: "blocked",
    },
    {
      name: "work_done_closeout_open",
      run: { status: "work_done_closeout_open" },
      second: "waiting",
      expected: "blocked",
    },
    {
      name: "paused",
      run: { status: "paused" },
      second: "running",
      expected: "paused",
    },
    {
      name: "running",
      run: { status: "running" },
      second: "running",
      expected: "running",
    },
    {
      name: "running with a paused member",
      run: { status: "running" },
      second: "paused",
      expected: "paused",
    },
    {
      name: "running without activity",
      run: { status: "running" },
      second: "waiting",
      expected: "ready",
    },
  ] as const)(
    "shows a run that is $name as $expected",
    ({ run, second, expected }) => {
      expect(planGroupProgress(group, unfinished(run, second)).state).toBe(
        expected,
      );
    },
  );

  it("shows a cancelled member as stopped though the run still runs", () => {
    const run = runOf([
      member("first", { status: "running" }),
      member("second", { status: "cancelled" }),
    ]);
    expect(planGroupProgress(group, run).state).toBe("stopped");
  });
});
