import { describe, expect, it } from "vitest";

import {
  fitsPlanParameter,
  isPlanFlowNode,
  isPlanResultNode,
  planConnectionIssues,
  planSourceType,
  withoutTicketFlow,
} from "@/definition/AgentPlanGraph";
import { emptyPlanStack } from "@/definition/AgentPlanStack";
import { agent, planOf, script } from "./plan-fixtures";
import {
  END,
  FILE,
  START,
  assetNode,
  closeout,
  connection,
  flow,
  numberNode,
  of,
  parameterNode,
  ticketNode,
  variableNode,
} from "./plan-graph-fixtures";

import type { AgentPlanScript } from "@/definition/AgentPlanScript";

describe("the kinds of plan nodes", () => {
  it("tells the nodes of the execution graph from value sources", () => {
    const flowing = [
      START,
      END,
      agent("a"),
      script("s"),
      closeout("c"),
      { ...emptyPlanStack("k", "k", { x: 0, y: 0 }) },
    ];

    expect(flowing.every(isPlanFlowNode)).toBe(true);
    expect(
      [ticketNode("t"), parameterNode("p", ""), assetNode("f")].some(
        isPlanFlowNode,
      ),
    ).toBe(false);
  });

  it("lets agents, the closeout and single-output scripts hand a result on", () => {
    const withOutput: AgentPlanScript = {
      ...script("s"),
      outputs: [{ name: "out", type: "text" }],
    };

    expect(isPlanResultNode(agent("a"))).toBe(true);
    expect(isPlanResultNode(closeout("c"))).toBe(true);
    expect(isPlanResultNode(withOutput)).toBe(true);
    expect(isPlanResultNode(script("s"))).toBe(false);
    expect(isPlanResultNode(START)).toBe(false);
    expect(isPlanResultNode(undefined)).toBe(false);
  });

  it("names the type a source node supplies", () => {
    expect(planSourceType(numberNode("p", 1))).toBe("number");
    expect(planSourceType(variableNode("v", "g"))).toBe("text");
    expect(planSourceType(ticketNode("t"))).toBe("ticket");
    expect(planSourceType(assetNode("f"))).toBe("asset");
    expect(planSourceType(agent("a"))).toBeNull();
    expect(planSourceType(undefined)).toBeNull();
  });

  it("lets a ticket also feed a text input, and nothing else cross types", () => {
    expect(fitsPlanParameter(ticketNode("t"), "ticket")).toBe(true);
    expect(fitsPlanParameter(ticketNode("t"), "text")).toBe(true);
    expect(fitsPlanParameter(ticketNode("t"), "number")).toBe(false);
    expect(fitsPlanParameter(numberNode("p", 1), "number")).toBe(true);
    expect(fitsPlanParameter(numberNode("p", 1), "text")).toBe(false);
    expect(fitsPlanParameter(undefined, "text")).toBe(false);
  });
});

describe("removing ticket nodes from the flow", () => {
  const ticket = ticketNode("t");

  it("returns the very plan when no edge touches a ticket", () => {
    const plan = planOf([START, ticket, agent("a")], [flow("start", "a")]);

    expect(withoutTicketFlow(plan)).toBe(plan);
  });

  it("joins the neighbours of a ticket directly", () => {
    const plan = planOf(
      [START, ticket, agent("a"), END],
      [flow("start", "t"), flow("t", "a"), flow("a", "end")],
    );

    const bridged = withoutTicketFlow(plan);

    expect(bridged.nodes).toBe(plan.nodes);
    expect(bridged.edges).toEqual([flow("a", "end"), flow("start", "a")]);
  });

  it("bridges every predecessor to every follower of a ticket", () => {
    const plan = planOf(
      [START, ticket, agent("a"), agent("b"), agent("c")],
      [
        flow("a", "t"),
        flow("b", "t"),
        flow("t", "c"),
        flow("t", "start"),
        flow("start", "t"),
      ],
    );

    const bridged = withoutTicketFlow(plan).edges;

    expect(bridged).toContainEqual(flow("a", "c"));
    expect(bridged).toContainEqual(flow("b", "c"));
    expect(bridged).toContainEqual(flow("a", "start"));
    expect(bridged).toContainEqual(flow("b", "start"));
    expect(bridged).not.toContainEqual(flow("start", "start"));
    expect(
      bridged.some((entry) => entry.from === "t" || entry.to === "t"),
    ).toBe(false);
  });

  it("neither duplicates an edge that exists nor closes a loop on one node", () => {
    const plan = planOf(
      [START, ticket, agent("a"), END],
      [flow("a", "end"), flow("a", "t"), flow("t", "end"), flow("t", "a")],
    );

    const bridged = withoutTicketFlow(plan).edges;

    expect(bridged.filter((entry) => entry.to === "end")).toHaveLength(1);
    expect(bridged.filter((entry) => entry.to === "a")).toEqual([]);
  });

  it("bridges a chain of tickets", () => {
    const plan = planOf(
      [START, ticketNode("t1"), ticketNode("t2"), agent("a")],
      [flow("start", "t1"), flow("t1", "t2"), flow("t2", "a")],
    );

    expect(withoutTicketFlow(plan).edges).toEqual([flow("start", "a")]);
  });
});

describe("checking the sources of a plan", () => {
  it("names a node id that occurs twice", () => {
    expect(connection([agent("a"), agent("a")])).toContainEqual({
      nodeId: null,
      port: null,
      reason: "duplicateNode",
    });
    expect(
      connection([agent("a"), agent("b")]).map((issue) => issue.reason),
    ).not.toContain("duplicateNode");
  });

  it("names a parameter node with an invalid name or value", () => {
    const issues = connection([
      parameterNode("bad", "x", "1 bad name"),
      numberNode("inf", Number.POSITIVE_INFINITY),
      parameterNode("fine", "x"),
    ]);

    expect(of(issues, "bad")).toEqual([
      { nodeId: "bad", port: "value-out", reason: "name" },
    ]);
    expect(of(issues, "inf")).toEqual([
      { nodeId: "inf", port: "value-out", reason: "number" },
    ]);
    expect(of(issues, "fine")).toEqual([]);
  });

  it("needs a variable node to name a global of the plan", () => {
    const plan = {
      ...planOf([variableNode("known", "g"), variableNode("lost", "h")]),
      globals: { g: "value" },
    };

    const issues = planConnectionIssues(plan, []);

    expect(of(issues, "known")).toEqual([]);
    expect(of(issues, "lost")).toEqual([
      { nodeId: "lost", port: "value-out", reason: "source" },
    ]);
  });

  it.each([
    { label: "blank", name: "   ", isValid: false },
    { label: "too long", name: "x".repeat(121), isValid: false },
    { label: "with a control character", name: "a\u0007b", isValid: false },
    { label: "with a delete character", name: "a\u007fb", isValid: false },
    { label: "padded", name: "  notes  ", isValid: true },
    { label: "at the length limit", name: "x".repeat(120), isValid: true },
  ])("judges an asset name that is $label", ({ name, isValid }) => {
    expect(of(connection([assetNode("f", FILE, name)]), "f")).toEqual(
      isValid ? [] : [{ nodeId: "f", port: null, reason: "name" }],
    );
  });
});

describe("checking the edges of a plan", () => {
  it("names a connection twice and a cycle", () => {
    const nodes = [START, agent("a"), agent("b")];

    expect(
      connection(nodes, [flow("start", "a"), flow("start", "a")]),
    ).toContainEqual({ nodeId: "a", port: "flow-in", reason: "duplicate" });
    expect(connection(nodes, [flow("a", "b"), flow("b", "a")])).toContainEqual({
      nodeId: "a",
      port: "flow-out",
      reason: "cycle",
    });
  });
});
