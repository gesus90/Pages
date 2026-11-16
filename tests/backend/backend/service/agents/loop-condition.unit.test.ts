import { expect, it } from "vitest";

import {
  evaluateLoopCondition,
  extractLoopJson,
  readLoopBoolean,
} from "@/backend/service/agents/loop/AgentPlanLoopCondition";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";

const LOOP = {
  ...emptyPlanLoop("loop", "Loop", { x: 0, y: 0 }),
  condition: {
    isEnabled: true,
    sourceNodeId: "step",
    outputPath: "$.items[0].done",
    operator: "equals" as const,
    expected: { type: "boolean" as const, value: true },
  },
};

it("extracts a whole JSON value or one marked block and refuses ambiguous output", () => {
  expect(extractLoopJson('{"done":true}')).toEqual({ value: { done: true } });
  expect(
    extractLoopJson("before\n```pages-loop-result\n[1,2]\n```\nafter"),
  ).toEqual({ value: [1, 2] });
  expect(extractLoopJson(null)).toEqual({
    failure: "plan_loop_output_missing",
  });
  expect(extractLoopJson("prose")).toEqual({
    failure: "plan_loop_output_missing",
  });
  expect(extractLoopJson("```pages-loop-result\ninvalid\n```")).toEqual({
    failure: "plan_loop_output_invalid",
  });
  expect(
    extractLoopJson(
      "```pages-loop-result\n1\n```\n```pages-loop-result\n2\n```",
    ),
  ).toEqual({ failure: "plan_loop_output_ambiguous" });
});

it("evaluates a nested result strictly and identifies missing or mismatched input", () => {
  const output = new Map([["step", '{"items":[{"done":true}]}']]);
  expect(evaluateLoopCondition(LOOP, output)).toEqual({
    state: "evaluated",
    isMet: true,
    found: { type: "boolean", value: true },
  });
  expect(
    evaluateLoopCondition({ ...LOOP, countMode: "expected" }, output),
  ).toEqual({ state: "not_evaluated", reason: "expected" });
  expect(evaluateLoopCondition({ ...LOOP, condition: null }, output)).toEqual({
    state: "not_evaluated",
    reason: "disabled",
  });
  expect(evaluateLoopCondition(LOOP, new Map())).toEqual({
    state: "failed",
    code: "plan_loop_condition_source",
  });
  expect(
    evaluateLoopCondition(
      { ...LOOP, condition: { ...LOOP.condition, outputPath: "invalid" } },
      output,
    ),
  ).toEqual({ state: "failed", code: "plan_loop_condition_path" });
  expect(
    evaluateLoopCondition(LOOP, new Map([["step", '{"items":[]}']])),
  ).toEqual({ state: "failed", code: "plan_loop_condition_field" });
  expect(
    evaluateLoopCondition(
      LOOP,
      new Map([["step", '{"items":[{"done":"true"}]}']]),
    ),
  ).toEqual({ state: "failed", code: "plan_loop_condition_type" });
});

it("reads while conditions without treating missing or nonboolean values as false", () => {
  expect(readLoopBoolean('{"continue":false}', "$.continue")).toEqual({
    value: false,
  });
  expect(readLoopBoolean("{}", "$.continue")).toEqual({
    failure: "plan_loop_condition_field",
  });
  expect(readLoopBoolean('{"continue":0}', "$.continue")).toEqual({
    failure: "plan_loop_while_type",
  });
  expect(readLoopBoolean("{}", "invalid")).toEqual({
    failure: "plan_loop_while_invalid",
  });
});
