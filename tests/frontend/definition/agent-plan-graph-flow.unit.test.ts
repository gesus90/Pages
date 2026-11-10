import { describe, expect, it } from "vitest";

import {
  planConnectionIssues,
  planExecutionIssues,
} from "@/definition/AgentPlanGraph";
import { emptyPlanStack } from "@/definition/AgentPlanStack";
import { agent, groupOf, loopOf, planOf, script } from "./plan-fixtures";
import {
  END,
  FILE,
  START,
  assetNode,
  closeout,
  configured,
  connection,
  execution,
  flow,
  of,
  parameterOf,
} from "./plan-graph-fixtures";

import type { AgentPlanEdge, AgentPlanNode } from "@/definition/AgentPlan";
import type { AgentPlanAssetFile } from "@/definition/AgentPlanAsset";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";

describe("the flow a plan needs before Play", () => {
  it("names a plan without start, end and agent", () => {
    expect(
      planExecutionIssues(planOf([]), []).map((issue) => issue.reason),
    ).toEqual(["start", "end", "agent"]);
  });

  it("accepts a script as the work of a plan", () => {
    expect(
      planExecutionIssues(
        planOf(
          [START, script("s"), END],
          [flow("start", "s"), flow("s", "end")],
        ),
        [],
      ),
    ).toEqual([]);
  });

  it("names a node that nothing leads to, leaves or finishes", () => {
    const issues = planExecutionIssues(
      planOf(
        [START, configured("a"), configured("lost"), END],
        [flow("start", "a"), flow("a", "end")],
      ),
      [],
    );

    expect(of(issues, "lost").map((issue) => issue.reason)).toEqual([
      "flowIn",
      "flowOut",
      "unreachable",
      "end",
    ]);
    expect(of(issues, "a")).toEqual([]);
  });

  it("only reads a stack that nothing triggers", () => {
    const stack = emptyPlanStack("stack", "Stack", { x: 0, y: 0 });

    expect(execution([configured("a")], [], [stack])).toEqual([]);
    expect(
      of(
        execution([configured("a")], [], [stack], [flow("start", "stack")]),
        "stack",
      ).map((issue) => issue.reason),
    ).toEqual(["flowOut", "end"]);
  });

  it("refuses the removed Git closeout until it is replaced", () => {
    expect(of(execution([closeout("c")]), "c")).toContainEqual({
      nodeId: "c",
      port: null,
      reason: "gitCloseoutUnsupported",
    });
  });

  it("needs a file for an asset an input reads, and only then", () => {
    const reading = (
      file: AgentPlanAssetFile | null,
      isUsed: boolean,
    ): readonly AgentPlanIssue[] =>
      execution(
        [
          configured("a", [parameterOf("doc", "asset")], {
            bindings: isUsed ? { doc: { kind: "source", nodeId: "f" } } : {},
          }),
        ],
        [],
        [assetNode("f", file)],
      );

    expect(reading(null, true)).toContainEqual({
      nodeId: "f",
      port: "value-out",
      reason: "assetFile",
    });
    expect(
      reading(null, true).filter((issue) => issue.reason === "assetFile"),
    ).toHaveLength(1);
    expect(reading(FILE, true)).toEqual([]);
    expect(reading(null, false)).toEqual([]);
  });
});

describe("the plans with groups, loops and events before Play", () => {
  const needed = parameterOf("topic", "text", { isRequired: true });

  function around(node: AgentPlanNode): readonly AgentPlanIssue[] {
    return planExecutionIssues(
      planOf(
        [START, node, END],
        [flow("start", node.id), flow(node.id, "end")],
      ),
      [],
    );
  }

  it("accepts a group whose agents are complete", () => {
    expect(around(groupOf("g", [configured("a1"), configured("a2")]))).toEqual(
      [],
    );
  });

  it("checks the agents of a group as flow nodes of the expanded plan", () => {
    expect(
      around(groupOf("g", [configured("a1", [needed]), configured("a2")])),
    ).toEqual([{ nodeId: "a1", port: "topic", reason: "required" }]);
  });

  it("accepts a loop whose members are complete", () => {
    expect(around(loopOf("l", [configured("m")]))).toEqual([]);
  });

  it("checks the members of a loop and the shell of the loop itself", () => {
    expect(around(loopOf("l", [configured("m", [needed])]))).toEqual([
      { nodeId: "m", port: "topic", reason: "required" },
    ]);
    expect(around(loopOf("l", []))).toContainEqual({
      nodeId: "l",
      port: null,
      reason: "loopSize",
    });
  });

  it("lets a result return to an earlier agent through an event", () => {
    const event: AgentPlanEdge = {
      from: "b",
      to: "a",
      fromPort: "value-out",
      toPort: "event-in",
    };
    const nodes = [START, configured("a"), configured("b"), END];
    const chain = [flow("start", "a"), flow("a", "b"), flow("b", "end")];

    expect(planExecutionIssues(planOf(nodes, [...chain, event]), [])).toEqual(
      [],
    );
    expect(
      planConnectionIssues(planOf(nodes, [...chain, event, event]), []),
    ).toContainEqual({ nodeId: "a", port: "event-in", reason: "duplicate" });
  });

  it("lets two connections with different ports join the same nodes", () => {
    const passed: AgentPlanEdge = {
      from: "a",
      to: "d",
      fromPort: "passed-out",
      toPort: "condition-in",
    };
    const issues = connection(
      [START, configured("a"), configured("b")],
      [flow("a", "b"), { ...passed, to: "b" }],
    );

    expect(issues.map((issue) => issue.reason)).not.toContain("duplicate");
  });
});

describe("an agent the offered list does not know", () => {
  it("is named by the connection check and again by the check of the run", () => {
    const agentIssue = { nodeId: "a", port: null, reason: "agent" };

    expect(of(connection([agent("a")]), "a")).toEqual([agentIssue]);
    expect(of(execution([agent("a")]), "a")).toEqual([agentIssue, agentIssue]);
  });
});
