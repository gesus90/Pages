import { expect, it } from "vitest";

import { readPlanNode } from "@/backend/agents/AgentPlanInput";

import { agentErrorCode } from "./agent-error-code";
import {
  POSITION,
  agentNode,
  groupNode,
  loopNode,
  scriptNode,
} from "./agent-plan-input-fixture";

import type { NodeFields } from "./agent-plan-input-fixture";

const GATE = { version: 1, requiredChecks: ["lint"] };

it("reads a script node with trimmed name and declared entries", () => {
  expect(
    readPlanNode(scriptNode({ executionTarget: { kind: "local" } })),
  ).toEqual({
    id: "s1",
    ...POSITION,
    type: "script",
    executionTarget: { kind: "local" },
    name: "Count",
    interpreterProfileId: "python",
    content: "print(1)",
    inputs: [{ name: "source", type: "text", isRequired: true }],
    outputs: [{ name: "result", type: "text" }],
    timeoutSeconds: 60,
    bindings: {},
  });
});

it.each<[string, NodeFields]>([
  ["a name that is no text", { name: 1 }],
  ["a profile that is no text", { interpreterProfileId: null }],
  ["content that is no text", { content: 1 }],
  ["a timeout that is no number", { timeoutSeconds: "60" }],
  ["inputs that are no list", { inputs: {} }],
  [
    "more than 64 inputs",
    {
      inputs: Array.from({ length: 65 }, () => ({
        name: "a",
        type: "text",
        isRequired: true,
      })),
    },
  ],
  [
    "an input without a text name",
    { inputs: [{ name: 1, type: "text", isRequired: true }] },
  ],
  [
    "an input of another type",
    { inputs: [{ name: "a", type: "number", isRequired: true }] },
  ],
  [
    "an input without a required flag",
    { inputs: [{ name: "a", type: "text" }] },
  ],
  ["outputs of another type", { outputs: [{ name: "result", type: "json" }] }],
  ["an empty content", { content: " " }],
  ["a timeout out of bounds", { timeoutSeconds: 0 }],
])("refuses a script node with %s", (scenario, change) => {
  expect(agentErrorCode(() => readPlanNode(scriptNode(change)))).toBe(
    "plan_script_invalid",
  );
});

it("reads a group node with ports, members and optional edges", () => {
  const group = readPlanNode(groupNode({ edges: [{ from: "m1", to: "m1" }] }));
  expect(group).toMatchObject({
    type: "group",
    name: "Group",
    steps: [{ id: "m1", type: "agent" }],
    edges: [{ from: "m1", to: "m1", fromPort: "flow-out", toPort: "flow-in" }],
    parameters: [{ id: "port-1", name: "topic", type: "text" }],
    bindings: {},
  });
  expect(readPlanNode(groupNode())).not.toHaveProperty("edges");
});

it.each<[string, NodeFields, string]>([
  ["members that are no list", { steps: {} }, "plan_invalid"],
  [
    "more than 50 members",
    { steps: Array.from({ length: 51 }, () => agentNode()) },
    "plan_invalid",
  ],
  ["parameters that are no list", { parameters: null }, "plan_invalid"],
  [
    "more than 64 parameters",
    { parameters: Array.from({ length: 65 }, () => ({})) },
    "plan_invalid",
  ],
  ["a member that is no agent", { steps: [scriptNode()] }, "plan_invalid"],
  ["a member that is no object", { steps: ["a1"] }, "plan_invalid"],
  [
    "a member with a work gate",
    { steps: [agentNode({ completionGate: GATE })] },
    "plan_work_gate_unavailable",
  ],
  [
    "a port without an id",
    {
      parameters: [
        {
          name: "topic",
          type: "text",
          description: "",
          isRequired: false,
          defaultValue: null,
        },
      ],
    },
    "plan_invalid",
  ],
  ["edges that are no list", { edges: {} }, "plan_invalid"],
  [
    "more than 100 edges",
    { edges: Array.from({ length: 101 }, () => ({ from: "a", to: "b" })) },
    "plan_invalid",
  ],
  ["a name that is too long", { name: "x".repeat(121) }, "plan_invalid"],
])("refuses a group node with %s", (scenario, change, code) => {
  expect(agentErrorCode(() => readPlanNode(groupNode(change)))).toBe(code);
});

it("reads a loop node with agent and script members and an end condition", () => {
  const loop = readPlanNode(
    loopNode({
      runsSource: "parameter",
      countMode: "expected",
      sessionPolicy: "fresh",
      condition: {
        isEnabled: true,
        sourceNodeId: "m3",
        outputPath: "$.done",
        operator: "equals",
        expected: { type: "boolean", value: true },
      },
    }),
  );
  expect(loop).toMatchObject({
    type: "loop",
    name: "Loop",
    steps: [
      { id: "m2", type: "agent" },
      { id: "m3", type: "script" },
    ],
    edges: [{ from: "m2", to: "m3" }],
    runs: 3,
    runsSource: "parameter",
    countMode: "expected",
    sessionPolicy: "fresh",
    condition: {
      sourceNodeId: "m3",
      expected: { type: "boolean", value: true },
    },
  });
});

it.each<[string, NodeFields, string]>([
  ["members that are no list", { steps: null }, "plan_loop_invalid"],
  [
    "more than 50 members",
    { steps: Array.from({ length: 51 }, () => agentNode()) },
    "plan_loop_invalid",
  ],
  ["an unknown count mode", { countMode: "min" }, "plan_loop_invalid"],
  [
    "an unknown session policy",
    { sessionPolicy: "shared" },
    "plan_loop_invalid",
  ],
  ["an unknown count source", { runsSource: "ticket" }, "plan_loop_invalid"],
  ["a count of zero", { runs: 0 }, "plan_loop_runs_invalid"],
  [
    "a member with a work gate",
    { steps: [agentNode({ completionGate: GATE })] },
    "plan_work_gate_unavailable",
  ],
  ["a nested loop", { steps: [loopNode({ id: "inner" })] }, "plan_loop_nested"],
  [
    "a nested group",
    { steps: [groupNode({ id: "inner" })] },
    "plan_loop_nested",
  ],
  [
    "a task member",
    { steps: [{ id: "t", ...POSITION, type: "task", taskId: "k" }] },
    "plan_loop_invalid",
  ],
  ["edges that are no list", { edges: undefined }, "plan_invalid"],
])("refuses a loop node with %s", (scenario, change, code) => {
  expect(agentErrorCode(() => readPlanNode(loopNode(change)))).toBe(code);
});
