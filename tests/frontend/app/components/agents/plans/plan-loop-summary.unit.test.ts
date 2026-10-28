import { expect, it } from "vitest";

import {
  planLoopEffectiveRuns,
  planLoopMemberResult,
  planLoopParameterNode,
  planLoopProgress,
  planLoopRunOf,
  planLoopSummary,
} from "@/app/components/agents/plans/plan-loop-summary";
import { PLAN_LOOP_RUNS_BINDING } from "@/definition/AgentPlanLoop";

import { runStep, syntheticRun } from "../page72-run-fixture";
import { i18n, planOf } from "./plan-flow-fixture";
import { loopIteration, loopRun, syntheticLoop } from "./plan-loop-fixture";

import type { AgentPlanNode } from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

const COUNT: AgentPlanNode = {
  id: "count",
  type: "parameter",
  x: 0,
  y: 0,
  name: "count",
  format: "number",
  value: { type: "number", number: 4 },
};

function boundLoop(nodeId: string): AgentPlanLoop {
  return syntheticLoop({
    runsSource: "parameter",
    bindings: { [PLAN_LOOP_RUNS_BINDING]: { kind: "source", nodeId } },
  });
}

it("finds the parameter node that feeds a loop's count, and nothing for other bindings", () => {
  const draft = planOf([COUNT, { id: "start", type: "start", x: 0, y: 0 }]);
  expect(planLoopParameterNode(draft, boundLoop("count"))).toBe(COUNT);
  expect(planLoopParameterNode(draft, boundLoop("start"))).toBeNull();
  expect(planLoopParameterNode(draft, boundLoop("gone"))).toBeNull();
  expect(planLoopParameterNode(draft, syntheticLoop())).toBeNull();
});

it("counts a loop from its own number or from its bound parameter, without a fallback", () => {
  const draft = planOf([COUNT]);
  expect(planLoopEffectiveRuns(draft, syntheticLoop({ runs: 7 }))).toBe(7);
  expect(planLoopEffectiveRuns(draft, boundLoop("count"))).toBe(4);
  expect(planLoopEffectiveRuns(draft, boundLoop("gone"))).toBeNull();
});

it("summarizes the count mode with the number of runs, or names an unusable source", () => {
  const draft = planOf([COUNT]);
  const mode = i18n.t("plans.loops.mode.maxShort");
  expect(planLoopSummary(draft, syntheticLoop(), i18n.t)).toBe(
    i18n.t("plans.loops.summary", { mode, count: 3 }),
  );
  expect(planLoopSummary(draft, boundLoop("gone"), i18n.t)).toBe(
    i18n.t("plans.loops.summaryUnresolved", { mode }),
  );
});

it("finds the record of a loop in a run, and nothing without a run or loops", () => {
  const run = loopRun([]);
  expect(planLoopRunOf(run, "loop")?.name).toBe("Review loop");
  expect(planLoopRunOf(run, "other")).toBeUndefined();
  expect(planLoopRunOf(syntheticRun(), "loop")).toBeUndefined();
  expect(planLoopRunOf(null, "loop")).toBeUndefined();
});

it("shows the current iteration within the effective count, starting at one", () => {
  const record = planLoopRunOf(
    loopRun([loopIteration(1, { state: "not_evaluated", reason: "disabled" })]),
    "loop",
  );
  expect(planLoopProgress(record)).toBe("1 / 3");
  expect(planLoopProgress(undefined)).toBeNull();
  if (!record) throw new Error("The loop record is missing");
  expect(planLoopProgress({ ...record, iterations: [] })).toBe("1 / 3");
  expect(
    planLoopProgress({
      ...record,
      iterations: [1, 2, 3, 4].map((number) =>
        loopIteration(number, { state: "not_evaluated", reason: "disabled" }),
      ),
    }),
  ).toBe("3 / 3");
  expect(planLoopProgress({ ...record, count: null })).toBeNull();
});

it("shows a member's result from its newest iteration only", () => {
  const first = {
    ...loopIteration(1, { state: "not_evaluated", reason: "disabled" }),
    nodes: [runStep("member", { output: "first" })],
  };
  const second = {
    ...loopIteration(2, { state: "not_evaluated", reason: "disabled" }),
    nodes: [runStep("member", { output: "second" })],
  };
  const run = loopRun([first, second]);
  expect(planLoopMemberResult(run, "member")?.output).toBe("second");
  expect(planLoopMemberResult(run, "other")).toBeUndefined();
  expect(planLoopMemberResult(null, "member")).toBeUndefined();
  expect(planLoopMemberResult(syntheticRun(), "member")).toBeUndefined();
});
