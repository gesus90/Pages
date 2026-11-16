import { expect, it } from "vitest";

import {
  planLoopBoundRuns,
  planLoopParameterBoolean,
  planLoopParameterRuns,
} from "@/definition/AgentPlanLoopGraph";
import { emptyPlanStack } from "@/definition/AgentPlanStack";

const PARAMETER = {
  id: "count",
  type: "parameter" as const,
  name: "Count",
  format: "number" as const,
  value: { type: "number" as const, number: 3 },
  x: 0,
  y: 0,
};

it("reads bounded numeric or textual iteration counts", () => {
  expect(planLoopParameterRuns(PARAMETER)).toBe(3);
  expect(
    planLoopParameterRuns({
      ...PARAMETER,
      value: { type: "number", number: 0 },
    }),
  ).toBe(0);
  expect(
    planLoopParameterRuns({
      ...PARAMETER,
      value: { type: "number", number: -1 },
    }),
  ).toBeNull();
  expect(
    planLoopParameterRuns({
      ...PARAMETER,
      value: { type: "text", text: " 12 " },
    }),
  ).toBe(12);
  expect(
    planLoopParameterRuns({
      ...PARAMETER,
      value: { type: "text", text: "1.5" },
    }),
  ).toBeNull();
  expect(planLoopParameterRuns(undefined)).toBeNull();
});

it("resolves counts from a parameter or the count of a stack", () => {
  const stack = {
    ...emptyPlanStack("stack", "Stack", { x: 0, y: 0 }),
    entries: [{ id: "one", type: "task" as const, taskId: "T1" }],
  };
  const plan = { nodes: [PARAMETER, stack] };
  expect(planLoopBoundRuns({ kind: "source", nodeId: "count" }, plan)).toBe(3);
  expect(
    planLoopBoundRuns(
      { kind: "stack", stackId: "stack", output: "count" },
      plan,
    ),
  ).toBe(1);
  expect(
    planLoopBoundRuns(
      { kind: "stack", stackId: "stack", output: "content" },
      plan,
    ),
  ).toBeNull();
  expect(planLoopBoundRuns(undefined, plan)).toBeNull();
});

it("reads only explicit boolean text for while loops", () => {
  expect(
    planLoopParameterBoolean({
      ...PARAMETER,
      value: { type: "text", text: " true " },
    }),
  ).toBe(true);
  expect(
    planLoopParameterBoolean({
      ...PARAMETER,
      value: { type: "text", text: "false" },
    }),
  ).toBe(false);
  expect(
    planLoopParameterBoolean({
      ...PARAMETER,
      value: { type: "text", text: "yes" },
    }),
  ).toBeNull();
  expect(planLoopParameterBoolean(PARAMETER)).toBeNull();
});
