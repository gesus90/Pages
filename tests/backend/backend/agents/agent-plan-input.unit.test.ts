import { expect, it } from "vitest";

import {
  readPlanBinding,
  readPlanInput,
  readPlanNode,
  readPlanText,
} from "@/backend/agents/AgentPlanInput";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { agentErrorCode } from "./agent-error-code";
import { POSITION, agentNode, planInput } from "./agent-plan-input-fixture";

import type { NodeFields } from "./agent-plan-input-fixture";

const NODE_CONFIGURATION = {
  name: "Copy",
  revision: 1,
  modelProfileId: "",
  model: "gpt-5",
  provider: null,
  reasoningEffort: null,
  template: { markdown: "", parameters: [], directoryParameter: null },
};

it("trims bounded text and refuses empty, long or control characters", () => {
  expect(readPlanText(" name ")).toBe("name");
  for (const input of [1, " ", "x".repeat(101), "a\u0007b"])
    expect(agentErrorCode(() => readPlanText(input))).toBe("plan_invalid");
  expect(readPlanText("x".repeat(120), 120)).toHaveLength(120);
});

it("reads a plan with defaults for edge ports and optional fields left out", () => {
  expect(readPlanInput(planInput())).toEqual({
    name: "Plan",
    workspaceId: "",
    usage: "private",
    globals: {},
    nodes: [
      { id: "start", ...POSITION, type: "start" },
      {
        id: "a1",
        ...POSITION,
        type: "agent",
        agentId: "agent-1",
        personalAgentId: null,
        instruction: "Review the ticket.",
        bindings: {},
      },
      { id: "end", ...POSITION, type: "end" },
    ],
    edges: [
      { from: "start", to: "a1", fromPort: "flow-out", toPort: "flow-in" },
      { from: "a1", to: "end", fromPort: "out", toPort: "in" },
    ],
  });
});

it("reads the optional plan fields", () => {
  const result = readPlanInput(
    planInput({
      workspaceId: " w1 ",
      usage: "workspace",
      projectId: " p1 ",
      revision: 4,
      executionTarget: { kind: "remote", workspaceId: "remote-1" },
      sharing: { isGlobal: false, targets: [{ kind: "group", targetId: "g" }] },
      globals: { greeting: "Hello" },
    }),
  );
  expect(result).toMatchObject({
    workspaceId: "w1",
    usage: "workspace",
    projectId: "p1",
    revision: 4,
    executionTarget: { kind: "remote", workspaceId: "remote-1" },
    sharing: {
      isGlobal: false,
      operator: "or",
      targets: [{ kind: "group", targetId: "g" }],
    },
    globals: { greeting: "Hello" },
  });
  expect(
    readPlanInput(
      planInput({
        sharing: {
          isGlobal: true,
          operator: "and",
          targets: [{ kind: "department", targetId: "d" }],
        },
      }),
    ).sharing,
  ).toEqual({
    isGlobal: true,
    operator: "and",
    targets: [{ kind: "department", targetId: "d" }],
  });
});

it.each<[string, unknown]>([
  ["no object", []],
  ["nodes that are no list", planInput({ nodes: {} })],
  [
    "too many nodes",
    planInput({ nodes: Array.from({ length: 501 }, () => ({})) }),
  ],
  ["edges that are no list", planInput({ edges: null })],
  [
    "too many edges",
    planInput({ edges: Array.from({ length: 501 }, () => ({})) }),
  ],
  ["an unknown usage", planInput({ usage: "public" })],
  ["a revision that is no number", planInput({ revision: "1" })],
  ["a fractional revision", planInput({ revision: 1.5 })],
  ["a revision below one", planInput({ revision: 0 })],
  [
    "an invalid execution target",
    planInput({ executionTarget: { kind: "cloud" } }),
  ],
  ["a share without a global flag", planInput({ sharing: { targets: [] } })],
  [
    "an unknown share operator",
    planInput({ sharing: { isGlobal: true, operator: "xor", targets: [] } }),
  ],
  [
    "a share with a person",
    planInput({
      sharing: { isGlobal: true, targets: [{ kind: "person", targetId: "p" }] },
    }),
  ],
  [
    "too many globals",
    planInput({
      globals: Object.fromEntries(
        Array.from({ length: 65 }, (_, index) => [`g${index}`, ""]),
      ),
    }),
  ],
  ["a global with an invalid name", planInput({ globals: { "1x": "" } })],
  ["a global that is no text", planInput({ globals: { greeting: 1 } })],
  [
    "a global that is too long",
    planInput({ globals: { greeting: "x".repeat(200_001) } }),
  ],
  [
    "an edge of another kind",
    planInput({ edges: [{ from: "a", to: "b", kind: "data" }] }),
  ],
  ["an empty workspace id", planInput({ workspaceId: " " })],
])("refuses a plan with %s", (scenario, input) => {
  expect(agentErrorCode(() => readPlanInput(input))).toBe("plan_invalid");
});

it("counts group and loop members against the node limit", () => {
  const members = Array.from({ length: 50 }, (_, index) =>
    agentNode({ id: `m${index}` }),
  );
  const groups = Array.from({ length: 10 }, (_, index) => ({
    id: `g${index}`,
    ...POSITION,
    type: "group",
    name: "Group",
    steps: members,
    parameters: [],
    bindings: {},
  }));
  expect(
    agentErrorCode(() => readPlanInput(planInput({ nodes: groups }))),
  ).toBe("plan_invalid");
});

it("reads task, variable and parameter nodes", () => {
  expect(
    readPlanNode({ id: "t", ...POSITION, type: "task", taskId: "k1" }),
  ).toEqual({ id: "t", ...POSITION, type: "task", taskId: "k1" });
  expect(
    readPlanNode({ id: "v", ...POSITION, type: "variable", name: "topic" }),
  ).toEqual({ id: "v", ...POSITION, type: "variable", name: "topic" });
  expect(
    readPlanNode({
      id: "p",
      ...POSITION,
      type: "parameter",
      name: "count",
      format: "number",
      value: { type: "text", text: "3" },
    }),
  ).toMatchObject({ type: "parameter", format: "number" });
});

it.each<[string, NodeFields, string]>([
  ["a fractional position", { x: 1.5 }, "plan_invalid"],
  ["a negative position", { y: -1 }, "plan_invalid"],
  ["a position beyond the canvas", { x: 6001 }, "plan_invalid"],
  ["a position that is no number", { y: "1" }, "plan_invalid"],
  [
    "a variable with an invalid name",
    { type: "variable", name: "1x" },
    "plan_invalid",
  ],
  [
    "a parameter with an invalid name",
    { type: "parameter", name: "1x", format: "string" },
    "plan_invalid",
  ],
  [
    "a parameter of an unknown format",
    { type: "parameter", name: "p", format: "xml" },
    "plan_invalid",
  ],
  [
    "a parameter with invalid JSON",
    {
      type: "parameter",
      name: "p",
      format: "json",
      value: { type: "text", text: "{" },
    },
    "plan_json_invalid",
  ],
  [
    "a parameter with a text that is no number",
    {
      type: "parameter",
      name: "p",
      format: "number",
      value: { type: "text", text: '"a"' },
    },
    "plan_number_invalid",
  ],
  ["an unknown node type", { type: "note" }, "plan_invalid"],
  ["an instruction that is no text", { instruction: 1 }, "plan_invalid"],
  [
    "an instruction that is too long",
    { instruction: "x".repeat(200_001) },
    "plan_invalid",
  ],
  ["an unknown completion", { completion: "silent" }, "plan_invalid"],
  [
    "an invalid execution target",
    { executionTarget: { kind: "remote" } },
    "plan_invalid",
  ],
  ["bindings that are no object", { bindings: [] }, "plan_invalid"],
  [
    "too many bindings",
    {
      bindings: Object.fromEntries(
        Array.from({ length: 65 }, (_, index) => [
          `b${index}`,
          { kind: "source", nodeId: "n" },
        ]),
      ),
    },
    "plan_invalid",
  ],
  [
    "a binding with an invalid name",
    { bindings: { "1x": { kind: "source", nodeId: "n" } } },
    "plan_invalid",
  ],
])("refuses an agent node with %s", (scenario, change, code) => {
  expect(agentErrorCode(() => readPlanNode(agentNode(change)))).toBe(code);
});

it("reads the optional parts of an agent node", () => {
  expect(
    readPlanNode(
      agentNode({
        agentId: "",
        personalAgentId: " personal ",
        completion: "todos",
        completionGate: { version: 1, requiredChecks: ["lint"] },
        executionTarget: { kind: "local" },
        configuration: NODE_CONFIGURATION,
        bindings: { topic: { kind: "literal", value: null } },
      }),
    ),
  ).toEqual({
    id: "a1",
    ...POSITION,
    type: "agent",
    agentId: "",
    personalAgentId: "personal",
    instruction: "Review the ticket.",
    completion: "todos",
    completionGate: { version: 1, requiredChecks: ["lint"] },
    executionTarget: { kind: "local" },
    configuration: NODE_CONFIGURATION,
    bindings: { topic: { kind: "literal", value: null } },
  });
  expect(
    readPlanNode(agentNode({ personalAgentId: "", completion: "report" })),
  ).not.toHaveProperty("completion");
});

it("refuses a malformed completion gate as an invalid request", () => {
  expect(() =>
    readPlanNode(agentNode({ completionGate: { version: 2 } })),
  ).toThrow(AgentOperationError);
});

it("reads every binding kind", () => {
  expect(
    readPlanBinding({ kind: "literal", value: { type: "number", number: 2 } }),
  ).toEqual({ kind: "literal", value: { type: "number", number: 2 } });
  expect(readPlanBinding({ kind: "source", nodeId: " n " })).toEqual({
    kind: "source",
    nodeId: "n",
  });
  expect(readPlanBinding({ kind: "result", stepId: "s" })).toEqual({
    kind: "result",
    stepId: "s",
  });
  expect(readPlanBinding({ kind: "previous", stepId: "s" })).toEqual({
    kind: "previous",
    stepId: "s",
  });
});

it.each<[unknown, string]>([
  [null, "plan_invalid"],
  [{ kind: "global" }, "plan_invalid"],
  [{ kind: "source", nodeId: "n", stepId: "s" }, "plan_binding_invalid"],
  [{ kind: "literal", value: { type: "date" } }, "parameter_invalid"],
])("refuses the binding %j as %s", (input, code) => {
  expect(agentErrorCode(() => readPlanBinding(input))).toBe(code);
});
