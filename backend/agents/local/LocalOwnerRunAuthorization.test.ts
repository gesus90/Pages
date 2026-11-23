import { expect, it } from "vitest";

import { canContinueLocalTurn } from "@/backend/agents/local/LocalOwnerRunAuthorization";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { LocalSessionLaunch } from "@/backend/agents/local/LocalSessionContracts";

const IDS = {
  run: "00000000-0000-4000-8000-000000000001",
  attempt: "00000000-0000-4000-8000-000000000002",
  instance: "00000000-0000-4000-8000-000000000003",
  turn: "00000000-0000-4000-8000-000000000004",
  user: "00000000-0000-4000-8000-000000000005",
};

const launch: LocalSessionLaunch = {
  runId: IDS.run,
  stepId: "step",
  sessionScopeId: "scope",
  attemptId: IDS.attempt,
  turnId: IDS.turn,
  isInstruction: false,
  instanceId: IDS.instance,
  userId: IDS.user,
  prompt: "prompt",
  instruction: "",
  resumeSessionId: null,
  timeoutMinutes: 0,
  mcp: null,
};

function session(
  overrides: Partial<AgentPlanSessionRecord> = {},
): AgentPlanSessionRecord {
  return {
    runner: "codex_cli",
    mode: "interactive",
    instanceId: IDS.instance,
    attemptId: IDS.attempt,
    sessionId: null,
    processId: null,
    startedAt: null,
    turnEndedAt: null,
    endedAt: null,
    exit: null,
    closeout: "pending",
    leftoverProcesses: null,
    resultCode: null,
    requested: {
      runner: "codex_cli",
      connectionId: "connection",
      connectionName: "Connection",
      model: "model",
      reasoningEffort: null,
      options: null,
      unattended: "none",
      mcp: false,
      directory: null,
    },
    effective: null,
    definition: null,
    contract: null,
    acceptance: null,
    events: [],
    ...overrides,
  };
}

function step(
  id: string,
  overrides: Partial<AgentPlanStepResult> = {},
): AgentPlanStepResult {
  return {
    id,
    name: id,
    status: "running",
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: null,
    session: session(),
    ...overrides,
  };
}

function run(overrides: Partial<AgentPlanRun> = {}): AgentPlanRun {
  return {
    id: IDS.run,
    planId: "plan",
    planName: "Plan",
    planRevision: 1,
    userId: IDS.user,
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "running",
    stopRequested: false,
    steps: [step("step")],
    ...overrides,
  };
}

it("rejects a missing run", () => {
  expect(canContinueLocalTurn(null, launch)).toBe(false);
});

it("rejects a run with a pending stop", () => {
  expect(canContinueLocalTurn(run({ stopRequested: true }), launch)).toBe(
    false,
  );
});

it.each(["stopping", "succeeded", "failed", "cancelled"] as const)(
  "rejects a %s run",
  (status) => {
    expect(canContinueLocalTurn(run({ status }), launch)).toBe(false);
  },
);

it.each(["running", "pausing", "paused"] as const)(
  "continues the exact attempt of a %s run",
  (status) => {
    expect(canContinueLocalTurn(run({ status }), launch)).toBe(true);
  },
);

it("rejects a run without the step, with another attempt or instance", () => {
  expect(canContinueLocalTurn(run({ steps: [] }), launch)).toBe(false);
  expect(canContinueLocalTurn(run({ steps: [step("other")] }), launch)).toBe(
    false,
  );
  expect(
    canContinueLocalTurn(
      run({
        steps: [
          step("step", {
            session: session({ attemptId: IDS.user }),
          }),
        ],
      }),
      launch,
    ),
  ).toBe(false);
  expect(
    canContinueLocalTurn(
      run({
        steps: [step("step", { session: session({ instanceId: IDS.user }) })],
      }),
      launch,
    ),
  ).toBe(false);
  expect(
    canContinueLocalTurn(
      run({ steps: [step("step", { session: null })] }),
      launch,
    ),
  ).toBe(false);
});

it.each(["failed", "cancelled"] as const)("rejects a %s step", (status) => {
  expect(
    canContinueLocalTurn(run({ steps: [step("step", { status })] }), launch),
  ).toBe(false);
});

it.each(["failed", "confirmed"] as const)(
  "rejects a step whose closeout is %s",
  (closeout) => {
    expect(
      canContinueLocalTurn(
        run({ steps: [step("step", { session: session({ closeout }) })] }),
        launch,
      ),
    ).toBe(false);
  },
);

it("finds the step among the members of a loop iteration", () => {
  const looped = run({
    steps: [],
    loops: [
      {
        id: "loop",
        name: "Loop",
        status: "running",
        count: null,
        sessionPolicy: "reuse",
        condition: null,
        iterations: [
          {
            id: "loop#1",
            number: 1,
            status: "running",
            startedAt: "2026-01-01T00:00:00.000Z",
            endedAt: null,
            nodes: [step("step")],
            condition: { state: "not_evaluated", reason: "disabled" },
            error: null,
          },
        ],
        sessions: [],
        completion: null,
        cleanup: "not_needed",
        startedAt: null,
        endedAt: null,
        error: null,
      },
    ],
  });
  expect(canContinueLocalTurn(looped, launch)).toBe(true);
});
