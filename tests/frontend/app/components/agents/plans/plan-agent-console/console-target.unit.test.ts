import { expect, it } from "vitest";

import {
  consoleSession,
  findConsoleNode,
  isRunActive,
  sessionAddress,
  sessionKeyText,
} from "@/app/components/agents/plans/plan-agent-console/console-target";

import {
  agent,
  boundary,
  groupOf,
  loopOf,
  planOf,
  script,
} from "../../../../../definition/plan-fixtures";
import {
  runStep,
  syntheticRun,
  syntheticSession,
} from "../../page72-run-fixture";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

const KEY = {
  planId: "plan one",
  runId: "run/1",
  stepId: "step?2",
  attemptId: "attempt&3",
} as const;

function cliSession(attemptId?: string): AgentPlanSessionRecord {
  return { ...syntheticSession(), runner: "codex_cli", attemptId };
}

function loopRun(memberId: string): AgentPlanLoopRun {
  const iteration = (
    number: number,
    output: string,
  ): AgentPlanLoopRun["iterations"][number] => ({
    id: `loop#${number}`,
    number,
    status: "succeeded",
    startedAt: "2026-10-15T10:00:00.000Z",
    endedAt: null,
    nodes: [
      runStep(memberId, { output, session: cliSession(`attempt-${number}`) }),
    ],
    condition: { state: "not_evaluated", reason: "disabled" },
    error: null,
  });
  return {
    id: "loop",
    name: "Loop",
    status: "succeeded",
    count: null,
    sessionPolicy: "reuse",
    condition: null,
    iterations: [iteration(1, "first"), iteration(2, "second")],
    sessions: [],
    completion: null,
    cleanup: "not_needed",
    startedAt: null,
    endedAt: null,
    error: null,
  };
}

const PLAN = planOf([
  boundary("start", "start"),
  agent("top"),
  loopOf("loop", [script("looped-script"), agent("looped-agent")]),
  groupOf("group", [agent("member")]),
  boundary("end", "end"),
]);

it("finds top-level agents, agent members of loops and groups, and groups themselves", () => {
  expect(findConsoleNode(PLAN, "top")).toEqual({
    kind: "agent",
    step: agent("top"),
  });
  expect(findConsoleNode(PLAN, "looped-agent")).toEqual({
    kind: "agent",
    step: agent("looped-agent"),
  });
  expect(findConsoleNode(PLAN, "member")).toEqual({
    kind: "agent",
    step: agent("member"),
  });
  const group = findConsoleNode(PLAN, "group");
  expect(group?.kind).toBe("group");
});

it("finds nothing for boundaries, script members, loops and unknown IDs", () => {
  expect(findConsoleNode(PLAN, "start")).toBeNull();
  expect(findConsoleNode(PLAN, "looped-script")).toBeNull();
  expect(findConsoleNode(PLAN, "loop")).toBeNull();
  expect(findConsoleNode(PLAN, "missing")).toBeNull();
});

it("treats only running, pausing, paused and stopping runs as active", () => {
  const run = syntheticRun();
  for (const status of ["running", "pausing", "paused", "stopping"] as const)
    expect(isRunActive({ ...run, status })).toBe(true);
  for (const status of ["succeeded", "failed", "cancelled"] as const)
    expect(isRunActive({ ...run, status })).toBe(false);
});

it("reports no run, a node that has not started and an API node without a CLI session", () => {
  const run = syntheticRun();
  expect(consoleSession(null, "Research")).toEqual({ kind: "no_run" });
  expect(consoleSession(run, "Review")).toEqual({ kind: "not_started" });
  expect(consoleSession(run, "missing")).toEqual({ kind: "not_started" });
  expect(consoleSession(run, "Research")).toEqual({ kind: "no_cli_session" });
});

it("keys a CLI session by its own attempt, or by instance and node for older records", () => {
  const base = syntheticRun();
  const run: AgentPlanRun = {
    ...base,
    steps: [
      runStep("recorded", { session: cliSession("attempt-recorded") }),
      runStep("older", { session: cliSession() }),
    ],
  };
  const recorded = consoleSession(run, "recorded");
  expect(recorded).toMatchObject({
    kind: "session",
    key: {
      planId: "synthetic-plan",
      runId: "synthetic-run",
      stepId: "recorded",
      attemptId: "attempt-recorded",
    },
  });
  expect(consoleSession(run, "older")).toMatchObject({
    kind: "session",
    key: { attemptId: "synthetic-instance:older" },
  });
});

it("takes a loop member's session from its latest iteration", () => {
  const run: AgentPlanRun = { ...syntheticRun(), loops: [loopRun("inner")] };
  const session = consoleSession(run, "inner");
  if (session.kind !== "session") throw new Error("Session missing");
  expect(session.step.output).toBe("second");
  expect(session.key.attemptId).toBe("attempt-2");
});

it("addresses a session route with encoded path parts and the plan and attempt in the query", () => {
  expect(sessionAddress(KEY)).toBe(
    "/agent-api/plan-runs/run%2F1/steps/step%3F2/session?planId=plan+one&attemptId=attempt%263",
  );
  expect(sessionAddress(KEY, "/events")).toBe(
    "/agent-api/plan-runs/run%2F1/steps/step%3F2/session/events?planId=plan+one&attemptId=attempt%263",
  );
  expect(sessionKeyText(KEY)).toBe("plan one/run/1/step?2/attempt&3");
});
