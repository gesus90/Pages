import { describe, expect, it } from "vitest";

import {
  readPlanContainedDecisions,
  readPlanDecisionNode,
} from "@/backend/agents/AgentPlanDecisionInput";
import { readPlanBinding, readPlanNode } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";

const BASE = { id: "d", x: 1, y: 2 };

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof AgentError ? error.code : undefined;
  }
  return undefined;
}

function read(node: Record<string, unknown>): unknown {
  return readPlanDecisionNode(node, BASE, readPlanBinding);
}

describe("readPlanDecisionNode", () => {
  it("reads a bare draft decision", () => {
    expect(read({})).toEqual({ ...BASE, type: "decision" });
  });

  it("reads a complete model decision", () => {
    expect(
      read({
        name: " Check ",
        mode: "model",
        question: "Is it ok?",
        model: { connectionId: " c ", model: " m " },
        output: "classification",
        cases: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
        input: { kind: "source", nodeId: "n" },
      }),
    ).toEqual({
      ...BASE,
      type: "decision",
      name: "Check",
      mode: "model",
      question: "Is it ok?",
      model: { connectionId: "c", model: "m" },
      output: "classification",
      cases: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      input: { kind: "source", nodeId: "n" },
    });
    expect(
      read({
        mode: "boolean",
        output: "boolean",
        input: { kind: "result", stepId: "s" },
      }),
    ).toEqual({
      ...BASE,
      type: "decision",
      mode: "boolean",
      output: "boolean",
      input: { kind: "result", stepId: "s" },
    });
  });

  it("drops the model of an older text model", () => {
    expect(read({ model: { provider: "x" } })).toEqual({
      ...BASE,
      type: "decision",
    });
    expect(read({ model: { reasoningEffort: "high" } })).toEqual({
      ...BASE,
      type: "decision",
    });
  });

  it("rejects malformed settings", () => {
    const invalid: Record<string, unknown>[] = [
      { mode: "other" },
      { output: "other" },
      { name: " " },
      { name: 1 },
      { name: "x".repeat(121) },
      { name: "a\u0001b" },
      { question: 1 },
      { question: "x".repeat(4001) },
      { model: { connectionId: "", model: "m" } },
      { model: { connectionId: "a b", model: "m" } },
      { model: { connectionId: "c", model: 1 } },
      { cases: "x" },
      { cases: Array.from({ length: 21 }, () => ({ id: "a", name: "A" })) },
      { cases: [{ id: "a", name: "x".repeat(61) }] },
      { input: { kind: "literal", value: null } },
    ];
    for (const node of invalid)
      expect(codeOf(() => read(node))).toMatch(
        /^plan_(invalid|binding_invalid)$/u,
      );
    expect(
      codeOf(() => read({ input: { kind: "literal", value: null } })),
    ).toBe("plan_binding_invalid");
    expect(codeOf(() => read({ mode: "other" }))).toBe("plan_invalid");
  });
});

describe("readPlanContainedDecisions", () => {
  const decision = { type: "decision", id: "d", x: 1, y: 2 };

  it("returns nothing for an absent or empty list", () => {
    expect(readPlanContainedDecisions(undefined, readPlanNode)).toEqual({});
    expect(readPlanContainedDecisions([], readPlanNode)).toEqual({});
  });

  it("reads contained decisions", () => {
    expect(readPlanContainedDecisions([decision], readPlanNode)).toEqual({
      decisions: [{ ...BASE, type: "decision" }],
    });
  });

  it("rejects a non-list, a long list and other node types", () => {
    expect(codeOf(() => readPlanContainedDecisions("x", readPlanNode))).toBe(
      "plan_invalid",
    );
    expect(
      codeOf(() =>
        readPlanContainedDecisions(
          Array.from({ length: 51 }, () => decision),
          readPlanNode,
        ),
      ),
    ).toBe("plan_invalid");
    expect(
      codeOf(() =>
        readPlanContainedDecisions(
          [{ type: "variable", id: "v", x: 1, y: 2, name: "v" }],
          readPlanNode,
        ),
      ),
    ).toBe("plan_invalid");
  });
});
