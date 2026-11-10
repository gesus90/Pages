import { describe, expect, it } from "vitest";

import { emptyPlanStack } from "@/definition/AgentPlanStack";
import { agent } from "./plan-fixtures";
import {
  START,
  closeout,
  choice,
  configured,
  connection,
  flow,
  numberNode,
  of,
  parameterNode,
  parameterOf,
  portIssues,
  ticketNode,
  textScript,
} from "./plan-graph-fixtures";

import type { AgentParameter } from "@/definition/AgentParameters";
import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanNode,
} from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";

describe("checking the binding of a node", () => {
  const text = parameterOf("text", "text");
  const count = parameterOf("count", "number");

  it("names an agent that is neither configured nor offered, and checks nothing else", () => {
    const unknown = agent("a", { text: { kind: "literal", value: null } });

    expect(portIssues(unknown)).toEqual([
      { nodeId: "a", port: null, reason: "agent" },
    ]);
    expect(of(connection([unknown], [], [choice("agent-1")]), "a")).toEqual([
      { nodeId: "a", port: "text", reason: "port" },
    ]);
  });

  it("refuses a binding to an input the node does not declare", () => {
    const step = configured("a", [text], {
      bindings: { other: { kind: "literal", value: null } },
    });

    expect(portIssues(step)).toEqual([
      { nodeId: "a", port: "other", reason: "port" },
    ]);
  });

  it("checks literal values against the type of the input", () => {
    const literal = (value: AgentPlanBinding): readonly AgentPlanIssue[] =>
      portIssues(configured("a", [text, count], { bindings: { text: value } }));

    expect(literal({ kind: "literal", value: null })).toEqual([]);
    expect(
      literal({ kind: "literal", value: { type: "text", text: "x" } }),
    ).toEqual([]);
    expect(
      literal({ kind: "literal", value: { type: "number", number: 1 } }),
    ).toEqual([{ nodeId: "a", port: "text", reason: "type" }]);
  });

  it("checks a source node against the type of the input", () => {
    const fed = (source: AgentPlanNode): readonly AgentPlanIssue[] =>
      portIssues(
        configured("a", [count], {
          bindings: { count: { kind: "source", nodeId: source.id } },
        }),
        [source],
      );

    expect(fed(numberNode("p", 3))).toEqual([]);
    expect(fed(parameterNode("p", "x"))).toEqual([
      { nodeId: "a", port: "count", reason: "type" },
    ]);
    expect(
      portIssues(
        configured("a", [count], {
          bindings: { count: { kind: "source", nodeId: "missing" } },
        }),
      ),
    ).toEqual([{ nodeId: "a", port: "count", reason: "type" }]);
  });

  it("leaves a binding to the previous iteration to the loop that owns it", () => {
    const step = configured("a", [text], {
      bindings: { text: { kind: "previous", stepId: "b" } },
    });

    expect(
      portIssues(step).filter((issue) => issue.reason !== "loopPrevious"),
    ).toEqual([]);
  });
});

describe("checking the bindings that read a stack or a result", () => {
  const text = parameterOf("text", "text");
  const count = parameterOf("count", "number");
  const ticketInput = parameterOf("ticket", "ticket");

  it("checks what a stack hands over against the type of the input", () => {
    const stack = {
      ...emptyPlanStack("stack", "Stack", { x: 0, y: 0 }),
      entries: [
        {
          id: "e1",
          type: "parameter" as const,
          name: "p",
          format: "string" as const,
          value: { type: "text" as const, text: "x" },
        },
      ],
    };
    const reading = (
      output: "content" | "count",
      input: AgentParameter,
    ): readonly AgentPlanIssue[] =>
      portIssues(
        configured("a", [input], {
          bindings: {
            [input.name]: { kind: "stack", stackId: "stack", output },
          },
        }),
        [stack],
        [flow("stack", "a")],
      );

    expect(reading("content", text)).toEqual([]);
    expect(reading("count", count)).toEqual([]);
    expect(reading("count", ticketInput)).toEqual([
      { nodeId: "a", port: "ticket", reason: "type" },
    ]);
    expect(reading("content", count)).toEqual([
      { nodeId: "a", port: "count", reason: "type" },
    ]);
    expect(
      portIssues(
        configured("a", [text], {
          bindings: {
            text: { kind: "stack", stackId: "nothing", output: "content" },
          },
        }),
      ),
    ).toContainEqual({ nodeId: "a", port: "text", reason: "type" });
  });

  it("takes a result as text only, from a node that hands one on, after it", () => {
    const resultOf = (
      input: AgentParameter,
      source: AgentPlanNode,
      edges: AgentPlanEdge[],
    ): readonly AgentPlanIssue[] =>
      portIssues(
        configured("a", [input], {
          bindings: { [input.name]: { kind: "result", stepId: source.id } },
        }),
        [source],
        edges,
      );
    const previous = configured("b");

    expect(resultOf(text, previous, [flow("b", "a")])).toEqual([]);
    expect(resultOf(text, previous, [])).toEqual([
      { nodeId: "a", port: "text", reason: "resultOrder" },
    ]);
    expect(resultOf(text, START, [flow("start", "a")])).toEqual([
      { nodeId: "a", port: "text", reason: "resultSource" },
    ]);
    expect(resultOf(ticketInput, previous, [flow("b", "a")])).toEqual([
      { nodeId: "a", port: "ticket", reason: "ticketHandoff" },
    ]);
    expect(resultOf(count, previous, [flow("b", "a")])).toEqual([
      { nodeId: "a", port: "count", reason: "type" },
    ]);
  });
});

describe("checking the bindings of scripts and the Git closeout", () => {
  it("reads the inputs of a script from its declaration", () => {
    const declared = textScript(
      "s",
      [{ name: "in", type: "text", isRequired: false }],
      {
        in: { kind: "literal", value: { type: "text", text: "x" } },
        ghost: { kind: "literal", value: null },
      },
    );

    expect(portIssues(declared)).toEqual([
      { nodeId: "s", port: "ghost", reason: "port" },
    ]);
  });

  it("reads the single ticket input of the Git closeout", () => {
    const node = closeout("c", {
      ticket: { kind: "source", nodeId: "t" },
      extra: { kind: "literal", value: null },
    });

    expect(portIssues(node, [ticketNode("t")])).toEqual([
      { nodeId: "c", port: "extra", reason: "port" },
    ]);
  });
});
