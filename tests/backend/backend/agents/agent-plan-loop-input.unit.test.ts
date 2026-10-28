import { expect, it } from "vitest";

import {
  readPlanLoopCondition,
  readPlanLoopValue,
} from "@/backend/agents/AgentPlanLoopInput";

import { agentErrorCode } from "./agent-error-code";

const CONDITION = {
  isEnabled: true,
  sourceNodeId: "node",
  outputPath: "$.review.done",
  operator: "equals",
  expected: { type: "boolean", value: true },
};

it("reads every typed expected value", () => {
  expect(readPlanLoopValue({ type: "null" })).toEqual({ type: "null" });
  expect(readPlanLoopValue({ type: "boolean", value: false })).toEqual({
    type: "boolean",
    value: false,
  });
  expect(readPlanLoopValue({ type: "number", value: 2 })).toEqual({
    type: "number",
    value: 2,
  });
  expect(readPlanLoopValue({ type: "string", value: "ok" })).toEqual({
    type: "string",
    value: "ok",
  });
});

it.each([
  { type: "boolean", value: "true" },
  { type: "number", value: "1" },
  { type: "number", value: Number.NaN },
  { type: "string", value: 1 },
  { type: "string", value: "x".repeat(1_001) },
  { type: "date" },
])("refuses the expected value %j", (value) => {
  expect(agentErrorCode(() => readPlanLoopValue(value))).toBe(
    "plan_loop_invalid",
  );
});

it("reads no condition and a condition with an empty path", () => {
  expect(readPlanLoopCondition(null)).toBeNull();
  expect(readPlanLoopCondition(undefined)).toBeNull();
  expect(readPlanLoopCondition(CONDITION)).toEqual(CONDITION);
  expect(
    readPlanLoopCondition({ ...CONDITION, isEnabled: false, outputPath: "" }),
  ).toMatchObject({ isEnabled: false, outputPath: "" });
});

it.each<[string, Record<string, unknown>]>([
  ["an enabled flag that is no boolean", { isEnabled: "yes" }],
  ["a source that is no text", { sourceNodeId: 1 }],
  ["a source that is too long", { sourceNodeId: "x".repeat(101) }],
  ["another operator", { operator: "contains" }],
  ["a path that is no text", { outputPath: null }],
  ["an unsupported path", { outputPath: "$..all" }],
  ["a malformed expected value", { expected: { type: "date" } }],
])("refuses a condition with %s", (scenario, change) => {
  expect(
    agentErrorCode(() => readPlanLoopCondition({ ...CONDITION, ...change })),
  ).toBe("plan_loop_invalid");
});
