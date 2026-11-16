import { expect, it } from "vitest";

import { buildRunTimeline } from "@/backend/service/agents/diagnosis/RunTimeline";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RunActivity } from "@/backend/database/repositories/diagnosis/AgentRunActivityRepository";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

const START = "2030-01-01T00:00:00.000Z";
const LATER = "2030-01-01T00:01:00.000Z";
const END = "2030-01-01T00:02:00.000Z";
const ACTIVITY = partial<RunActivity>({
  attemptEvents: new Map(),
  attemptLogs: new Map(),
  stepProgress: new Map(),
});

it("orders retry, start and failure events with their attempt identities", () => {
  const step = partial<AgentPlanStepResult>({
    id: "work",
    name: "Work",
    status: "failed",
    error: "failure",
    session: {
      attemptId: "current",
      startedAt: LATER,
      endedAt: END,
      retry: {
        attempts: [{ attemptId: "first", endedAt: START, code: "busy" }],
      },
    },
  });
  const run = partial<AgentPlanRun>({
    status: "failed",
    startedAt: START,
    steps: [step],
  });
  const result = buildRunTimeline(run, ACTIVITY, {
    now: Date.parse(END),
    stallMs: 1000,
  });
  expect(result.entries.map((entry) => [entry.event, entry.attemptId])).toEqual(
    [
      ["failed", "first"],
      ["retrying", "current"],
      ["started", "current"],
      ["failed", "current"],
    ],
  );
  expect(result.entries.at(-1)).toMatchObject({
    durationMs: 60_000,
    reason: "failure",
  });
  expect(result.stalled).toEqual([]);
});

it("reports workspace waits and only marks a running step stalled after its latest activity", () => {
  const waiting = partial<AgentPlanStepResult>({
    id: "wait",
    name: "Wait",
    status: "waiting",
  });
  const running = partial<AgentPlanStepResult>({
    id: "work",
    name: "Work",
    status: "running",
    session: { attemptId: "attempt", startedAt: START },
  });
  const run = partial<AgentPlanRun>({
    status: "running",
    startedAt: START,
    isWaitingForWorkspace: true,
    workspaceWait: { reason: "busy" },
    steps: [waiting, running],
  });
  const activity = { ...ACTIVITY, attemptLogs: new Map([["attempt", LATER]]) };
  const result = buildRunTimeline(run, activity, {
    now: Date.parse(END),
    stallMs: 60_000,
  });
  expect(result.entries[0]).toMatchObject({
    event: "waiting",
    reason: "workspace_busy: busy",
  });
  expect(result.stalled).toEqual([
    {
      stepId: "work",
      attemptId: "attempt",
      lastEventAt: LATER,
      stalledForMs: 60_000,
    },
  ]);
  expect(
    buildRunTimeline(run, activity, { now: Date.parse(END), stallMs: 60_001 })
      .stalled,
  ).toEqual([]);
});
