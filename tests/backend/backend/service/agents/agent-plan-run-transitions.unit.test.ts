import { expect, it } from "vitest";

import { detectPlanRunTransitions } from "@/backend/service/agents/AgentPlanRunTransitions";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanRun } from "@/definition/AgentPlan";

function run(status: AgentPlanRun["status"]): AgentPlanRun {
  return partial<AgentPlanRun>({
    id: "run-1",
    planId: "plan-1",
    userId: "user-1",
    status,
    steps: [],
    loops: [],
    stopRequested: false,
  });
}

function countPauses(previous: AgentPlanRun, next: AgentPlanRun): number {
  return detectPlanRunTransitions(previous, next).filter(
    (transition) => transition.kind === "run_paused",
  ).length;
}

it("announces the write that reaches paused, never pausing or a repeated view", () => {
  expect(countPauses(run("running"), run("pausing"))).toBe(0);
  expect(detectPlanRunTransitions(run("pausing"), run("paused"))).toEqual([
    { kind: "run_paused" },
  ]);
  expect(countPauses(run("paused"), run("paused"))).toBe(0);
  expect(countPauses(run("paused"), run("running"))).toBe(0);
});

it("announces each pause of pause, resume, pause and none for the resume", () => {
  const views = [
    run("running"),
    run("pausing"),
    run("paused"),
    run("running"),
    run("pausing"),
    run("paused"),
  ];
  const pauses = views
    .slice(1)
    .reduce((total, view, index) => total + countPauses(views[index], view), 0);

  expect(pauses).toBe(2);
  expect(countPauses(views[2], views[3])).toBe(0);
});
