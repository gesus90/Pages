import { describe, expect, it } from "vitest";

import {
  planConnectionIssues,
  planExecutionIssues,
} from "@/definition/AgentPlanGraph";
import { planOf, script } from "./plan-fixtures";
import {
  END,
  START,
  assetNode,
  configured,
  execution,
  flow,
  of,
  parameterOf,
} from "./plan-graph-fixtures";

describe("composed plan graph validation", () => {
  it("accepts a result through an intermediate step and rejects it without an ordering path", () => {
    const input = parameterOf("summary", "text", { isRequired: true });
    const reader = configured("reader", [input], {
      bindings: { summary: { kind: "result", stepId: "producer" } },
    });
    const producer = {
      ...script("producer"),
      outputs: [{ name: "out", type: "text" as const }],
    };
    const nodes = [START, producer, configured("middle"), reader, END];
    const edges = [
      flow("start", "producer"),
      flow("producer", "middle"),
      flow("middle", "reader"),
      flow("reader", "end"),
    ];

    expect(planExecutionIssues(planOf(nodes, edges), [])).toEqual([]);
    expect(
      of(
        planConnectionIssues(
          planOf(
            nodes,
            edges.filter((edge) => edge.from !== "producer"),
          ),
          [],
        ),
        "reader",
      ),
    ).toContainEqual({
      nodeId: "reader",
      port: "summary",
      reason: "resultOrder",
    });
  });

  it("requires a file only once when several inputs read the same asset", () => {
    const inputs = [
      parameterOf("first", "asset", { isRequired: true }),
      parameterOf("second", "asset", { isRequired: true }),
    ];
    const reader = configured("reader", inputs, {
      bindings: {
        first: { kind: "source", nodeId: "document" },
        second: { kind: "source", nodeId: "document" },
      },
    });
    const issues = execution([reader], [], [assetNode("document", null)]);

    expect(of(issues, "document")).toEqual([
      { nodeId: "document", port: "value-out", reason: "assetFile" },
    ]);
    expect(of(issues, "reader")).toEqual([
      { nodeId: "reader", port: "first", reason: "required" },
      { nodeId: "reader", port: "second", reason: "required" },
    ]);
    expect(execution([reader], [], [assetNode("document")])).toEqual([]);
  });

  it("treats an explicit empty literal as missing even when the template has a default", () => {
    const input = parameterOf("topic", "text", {
      isRequired: true,
      defaultValue: { type: "text", text: "fallback" },
    });
    const reader = configured("reader", [input], {
      markdown: "Use {{topic}}",
      bindings: { topic: { kind: "literal", value: null } },
    });

    expect(of(execution([reader]), "reader")).toEqual([
      { nodeId: "reader", port: "topic", reason: "resultMissing" },
    ]);
    expect(
      execution([configured("reader", [input], { markdown: "Use {{topic}}" })]),
    ).toEqual([]);
  });

  it("detects a self-cycle on a flow edge", () => {
    expect(
      planConnectionIssues(planOf([configured("a")], [flow("a", "a")]), []),
    ).toContainEqual({
      nodeId: "a",
      port: "flow-out",
      reason: "cycle",
    });
  });
});
