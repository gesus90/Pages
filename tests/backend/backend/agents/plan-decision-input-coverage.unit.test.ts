import { expect, it } from "vitest";

import {
  readPlanContainedDecisions,
  readPlanDecisionNode,
} from "@/backend/agents/AgentPlanDecisionInput";

import type { AgentPlanBinding, AgentPlanNode } from "@/definition/AgentPlan";

const BASE = { id: "decision", x: 1, y: 2 };
const SOURCE: AgentPlanBinding = { kind: "source", nodeId: "source" };
const readSource = (): AgentPlanBinding => SOURCE;

it("preserves absent settings on historical decisions and reads a model decision", () => {
  expect(readPlanDecisionNode({}, BASE, readSource)).toEqual({
    ...BASE,
    type: "decision",
  });
  expect(
    readPlanDecisionNode(
      {
        name: " Choice ",
        mode: "model",
        question: "Choose",
        output: "classification",
        model: {
          connectionId: " connection ",
          provider: "codex_cli",
          model: " model ",
          reasoningEffort: null,
        },
        cases: [{ id: " first ", name: "First" }],
        input: {},
      },
      BASE,
      readSource,
    ),
  ).toEqual({
    ...BASE,
    type: "decision",
    name: "Choice",
    mode: "model",
    question: "Choose",
    output: "classification",
    model: {
      connectionId: "connection",
      provider: "codex_cli",
      model: "model",
      reasoningEffort: null,
    },
    cases: [{ id: "first", name: "First" }],
    input: SOURCE,
  });
});

it.each([
  { mode: "unknown" },
  { name: "  " },
  { name: "a".repeat(121) },
  { question: "bad\u0000text" },
  { output: "unknown" },
  { cases: "bad" },
  { cases: Array.from({ length: 21 }, () => ({ id: "x", name: "X" })) },
  { cases: [{ id: "two words", name: "X" }] },
  {
    model: {
      connectionId: "x",
      provider: "invalid",
      model: "m",
      reasoningEffort: null,
    },
  },
  {
    model: {
      connectionId: "",
      provider: "codex_cli",
      model: "m",
      reasoningEffort: null,
    },
  },
  {
    model: {
      connectionId: "x",
      provider: "codex_cli",
      model: "m",
      reasoningEffort: 1,
    },
  },
])("rejects invalid decision fields: %j", (node) => {
  expect(() => readPlanDecisionNode(node, BASE, readSource)).toThrow();
});

it("rejects bindings that do not refer to a source or result", () => {
  expect(() =>
    readPlanDecisionNode({ input: {} }, BASE, () => ({
      kind: "literal",
      value: { type: "text", text: "x" },
    })),
  ).toThrow();
});

it("reads contained decisions and rejects other nodes or oversized lists", () => {
  const decision = readPlanDecisionNode({}, BASE, readSource);
  const readNode = (): AgentPlanNode => decision;
  expect(readPlanContainedDecisions(undefined, readNode)).toEqual({});
  expect(readPlanContainedDecisions([], readNode)).toEqual({});
  expect(readPlanContainedDecisions([{}], readNode)).toEqual({
    decisions: [decision],
  });
  expect(() =>
    readPlanContainedDecisions(Array.from({ length: 51 }), readNode),
  ).toThrow();
  expect(() =>
    readPlanContainedDecisions([{}], () => ({
      ...BASE,
      type: "end",
    })),
  ).toThrow();
});
