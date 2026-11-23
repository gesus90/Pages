import { describe, expect, it } from "vitest";

import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";

const STEP = {
  id: "step",
  name: "Step",
  status: "succeeded",
  cancellation: "none",
  isBlocked: false,
  output: null,
  error: null,
  session: null,
};

const RUN = {
  id: "run",
  planId: "plan",
  planName: "Plan",
  userId: "user",
  startedAt: "2026-01-01T00:00:00.000Z",
  planRevision: 1,
  status: "succeeded",
  stopRequested: false,
  steps: [STEP],
};

const USAGE = {
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 3,
  cacheWriteTokens: 4,
  costUsd: null,
  subscription: true,
  isIncomplete: false,
  hasUnknownPrice: false,
};

function run(change: Record<string, unknown>): Record<string, unknown> {
  return { ...RUN, ...change };
}

function rejects(input: unknown): void {
  expect(() => readPlanRun(input)).toThrowError(
    expect.objectContaining({ code: "plan_invalid" }),
  );
}

describe("readPlanRun required fields", () => {
  it("reads a minimal run", () => {
    const result = readPlanRun(RUN);
    expect(result).toMatchObject({
      id: "run",
      planName: "Plan",
      planRevision: 1,
      status: "succeeded",
      stopRequested: false,
    });
    expect(result.steps[0]?.id).toBe("step");
    expect(result).not.toHaveProperty("endedAt");
    expect(result).not.toHaveProperty("claudeUsage");
    expect(result).not.toHaveProperty("runnerJobs");
  });

  it.each([
    "running",
    "pausing",
    "stopping",
    "succeeded",
    "failed",
    "cancelled",
    "paused",
    "work_done_closeout_open",
  ])("accepts the status %s", (status) => {
    expect(readPlanRun(run({ status })).status).toBe(status);
  });

  it("rejects malformed required fields", () => {
    rejects(run({ status: "unknown" }));
    rejects(run({ status: 1 }));
    rejects(run({ planRevision: "1" }));
    rejects(run({ planRevision: 1.5 }));
    rejects(run({ planRevision: 0 }));
    rejects(run({ stopRequested: "no" }));
    rejects(run({ steps: "none" }));
    rejects(run({ steps: Array.from({ length: 101 }, () => STEP) }));
    rejects(run({ id: "" }));
    rejects(run({ planName: "p".repeat(121) }));
    rejects(run({ steps: [{ ...STEP, status: "unknown" }] }));
    rejects("run");
  });
});

describe("readPlanRun optional fields", () => {
  it("reads end time, errors and cleanup warnings", () => {
    const result = readPlanRun(
      run({
        endedAt: "2026-01-01T01:00:00.000Z",
        startError: "no start",
        startCleanupUnconfirmed: ["one", "two"],
        controlError: "plan_step_failed",
      }),
    );
    expect(result).toMatchObject({
      endedAt: "2026-01-01T01:00:00.000Z",
      startError: "no start",
      startCleanupUnconfirmed: ["one", "two"],
      controlError: "plan_step_failed",
    });
    expect(
      readPlanRun(run({ controlError: "plan_stop_unconfirmed" })).controlError,
    ).toBe("plan_stop_unconfirmed");
    expect(readPlanRun(run({ controlError: "other" }))).not.toHaveProperty(
      "controlError",
    );
  });

  it("rejects malformed errors and warnings", () => {
    rejects(run({ endedAt: "" }));
    rejects(run({ startError: "e".repeat(201) }));
    rejects(run({ startCleanupUnconfirmed: "none" }));
    rejects(run({ startCleanupUnconfirmed: [""] }));
  });
});

describe("readPlanRun nested records", () => {
  it("reads nested records", () => {
    const origin = {
      kind: "restart",
      runId: "old",
      mode: null,
      checkpointVersion: null,
      reusedStepIds: [],
      retriedStepIds: [],
      reviewedStepIds: [],
      requestedAt: "2026-01-01T00:00:00.000Z",
    };
    const result = readPlanRun(
      run({
        recovery: { state: "interrupted", requiresReconciliation: false },
        origin,
        invocation: {
          invocationId: "i",
          entryNodeId: "e",
          sourcePlanId: "p",
          sourceRunId: "r",
          sourceNodeId: "n",
          wait: "continue",
        },
        loops: [],
        stacks: [],
        runnerJobs: [],
        resourceReleases: [],
        command: {
          id: "c",
          runId: "run",
          action: "start",
          status: "accepted",
          acceptedAt: "now",
        },
        pauseBoundary: {
          pausedAt: "2026-01-01T00:00:00.000Z",
          completedStepIds: [],
          pendingStepIds: [],
          frontierStepIds: [],
        },
        continuation: {
          version: 1,
          planRevision: 1,
          adoptedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    );
    expect(result).toMatchObject({
      recovery: { state: "interrupted" },
      origin: { kind: "restart" },
      invocation: { wait: "continue" },
      loops: [],
      stacks: [],
      runnerJobs: [],
      resourceReleases: [],
      command: { action: "start" },
      pauseBoundary: { completedStepIds: [] },
      continuation: { version: 1 },
    });
  });

  it("rejects malformed nested records", () => {
    expect(() => readPlanRun(run({ recovery: { state: "other" } }))).toThrow();
    expect(() => readPlanRun(run({ origin: { kind: "other" } }))).toThrow();
    rejects(run({ invocation: {} }));
    rejects(run({ loops: "none" }));
    rejects(run({ stacks: "none" }));
    rejects(run({ continuation: { version: 0, planRevision: 1 } }));
  });

  it("rejects nested schema violations of retained evidence", () => {
    expect(() => readPlanRun(run({ runnerJobs: [{}] }))).toThrow();
    expect(() => readPlanRun(run({ resourceReleases: [{}] }))).toThrow();
    expect(() => readPlanRun(run({ command: {} }))).toThrow();
  });
});

describe("readPlanRun usage", () => {
  it("reads absent, null and measured Claude usage", () => {
    expect(readPlanRun(run({ claudeUsage: null })).claudeUsage).toBeNull();
    const claudeUsage = {
      steps: [{ attemptId: "a", name: "Step", usage: USAGE }],
      total: USAGE,
    };
    expect(readPlanRun(run({ claudeUsage })).claudeUsage).toEqual(claudeUsage);
    expect(() => readPlanRun(run({ claudeUsage: {} }))).toThrow();
  });
});

describe("readPlanRun waiting", () => {
  it("keeps a wait reason only while the run is active", () => {
    expect(
      readPlanRun(run({ status: "running", waitReason: "capacity" }))
        .waitReason,
    ).toBe("capacity");
    expect(
      readPlanRun(run({ status: "running", waitReason: "x" })),
    ).not.toHaveProperty("waitReason");
    expect(readPlanRun(run({ waitReason: "capacity" }))).not.toHaveProperty(
      "waitReason",
    );
  });

  const wait = {
    resource: "workspace",
    reason: "busy",
    runId: null,
    jobId: null,
    attemptId: null,
  };

  it("reads a live workspace wait with its details", () => {
    expect(
      readPlanRun(
        run({
          status: "running",
          isWaitingForWorkspace: true,
          workspaceWait: wait,
          workspaceWaitingSince: "2026-01-01T00:00:00.000Z",
        }),
      ),
    ).toMatchObject({
      isWaitingForWorkspace: true,
      workspaceWait: wait,
      workspaceWaitingSince: "2026-01-01T00:00:00.000Z",
    });
  });

  it("reads a live workspace wait without details", () => {
    const result = readPlanRun(
      run({ status: "running", isWaitingForWorkspace: true }),
    );
    expect(result.isWaitingForWorkspace).toBe(true);
    expect(result).not.toHaveProperty("workspaceWait");
    expect(result).not.toHaveProperty("workspaceWaitingSince");
  });

  it("drops a wait that is no longer live but still validates it", () => {
    const stale = readPlanRun(
      run({ isWaitingForWorkspace: true, workspaceWait: wait }),
    );
    expect(stale).not.toHaveProperty("isWaitingForWorkspace");
    expect(stale).not.toHaveProperty("workspaceWait");
    expect(
      readPlanRun(
        run({
          status: "running",
          stopRequested: true,
          isWaitingForWorkspace: true,
        }),
      ),
    ).not.toHaveProperty("isWaitingForWorkspace");
    expect(() =>
      readPlanRun(run({ workspaceWait: { resource: 1 } })),
    ).toThrow();
  });
});
