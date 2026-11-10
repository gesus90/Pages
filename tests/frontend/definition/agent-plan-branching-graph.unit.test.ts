import { describe, expect, it } from "vitest";

import {
  arePlanNodesOrdered,
  hasPlanReach,
  planBranchingIssues,
  planEdgeEndpointIssues,
  planEventOrderIssues,
} from "@/definition/AgentPlanBranchingGraph";

import {
  AGENTS,
  agentNode,
  branch,
  decision,
  edgeOf,
  event,
  flow,
  oneOutput,
  passed,
  reasons,
} from "./plan-branching-fixtures";
import { boundary, groupOf, loopOf, planOf, script } from "./plan-fixtures";
import { choice, closeout } from "./plan-graph-fixtures";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanStep,
} from "@/definition/AgentPlan";

describe("endpoints of an edge", () => {
  const nodes: AgentPlanNode[] = [
    boundary("start", "start"),
    boundary("end", "end"),
    agentNode("a"),
    agentNode("b"),
    decision("d"),
    groupOf("g", []),
    script("empty"),
    oneOutput("one"),
    closeout("c"),
  ];
  const plan = planOf(nodes);

  it("accepts the connections each kind of edge allows", () => {
    for (const edge of [
      flow("start", "a"),
      flow("a", "end"),
      flow("c", "d"),
      passed("a", "d"),
      branch("d", "true-out", "b"),
      branch("d", "case:one", "end"),
      event("a", "b"),
      event("one", "a"),
    ])
      expect(planEdgeEndpointIssues(plan, edge)).toEqual([]);
  });

  it("refuses a pair of ports that no kind of edge knows on both ends", () => {
    expect(
      planEdgeEndpointIssues(plan, edgeOf("a", "bogus", "b", "bogus-in")),
    ).toEqual([
      { nodeId: "a", port: "bogus", reason: "port" },
      { nodeId: "b", port: "bogus-in", reason: "port" },
    ]);
  });

  it("refuses an edge that leaves or enters a node of the wrong type", () => {
    expect(planEdgeEndpointIssues(plan, flow("end", "start"))).toEqual([
      { nodeId: "end", port: "flow-out", reason: "port" },
      { nodeId: "start", port: "flow-in", reason: "port" },
    ]);
    expect(planEdgeEndpointIssues(plan, branch("a", "true-out", "b"))).toEqual([
      { nodeId: "a", port: "true-out", reason: "port" },
    ]);
    expect(planEdgeEndpointIssues(plan, passed("a", "b"))).toEqual([
      { nodeId: "b", port: "condition-in", reason: "port" },
    ]);
    expect(planEdgeEndpointIssues(plan, event("a", "d"))).toEqual([
      { nodeId: "d", port: "event-in", reason: "port" },
    ]);
  });

  it("refuses an event from a script that does not declare exactly one output", () => {
    expect(planEdgeEndpointIssues(plan, event("empty", "a"))).toEqual([
      { nodeId: "empty", port: "value-out", reason: "port" },
    ]);
  });

  it("names a group boundary instead of a port when an edge touches a group directly", () => {
    expect(planEdgeEndpointIssues(plan, event("g", "a"))).toEqual([
      { nodeId: "g", port: "value-out", reason: "groupBoundary" },
    ]);
    expect(planEdgeEndpointIssues(plan, event("a", "g"))).toEqual([
      { nodeId: "g", port: "event-in", reason: "groupBoundary" },
    ]);
  });

  it("refuses an edge whose nodes do not exist", () => {
    expect(planEdgeEndpointIssues(plan, flow("x", "y"))).toEqual([
      { nodeId: "x", port: "flow-out", reason: "port" },
      { nodeId: "y", port: "flow-in", reason: "port" },
    ]);
  });
});

describe("the way back of an event", () => {
  it("has nothing to say about an edge that is no event", () => {
    const plan = planOf([agentNode("a"), agentNode("b")], [flow("a", "b")]);
    expect(planEventOrderIssues(plan, flow("a", "b"))).toEqual([]);
  });

  it("refuses an event whose source does not lie behind its target", () => {
    const plan = planOf(
      [agentNode("a"), agentNode("b")],
      [flow("a", "b"), event("a", "b")],
    );
    expect(planEventOrderIssues(plan, event("a", "b"))).toEqual([
      { nodeId: "b", port: "event-in", reason: "eventOrder" },
    ]);
  });

  it("accepts a return to an earlier node", () => {
    const back = event("b", "a");
    const plan = planOf(
      [agentNode("a"), agentNode("b")],
      [flow("a", "b"), back],
    );
    expect(planEventOrderIssues(plan, back)).toEqual([]);
  });

  it("refuses a second event of the same result and accepts the first", () => {
    const first = event("c", "a");
    const second = event("c", "b");
    const plan = planOf(
      [agentNode("a"), agentNode("b"), agentNode("c")],
      [flow("a", "c"), flow("b", "c"), first, second],
    );
    expect(planEventOrderIssues(plan, first)).toEqual([]);
    expect(planEventOrderIssues(plan, second)).toEqual([
      { nodeId: "c", port: "value-out", reason: "eventFanout" },
    ]);
  });

  it("refuses a return across another agent that receives events", () => {
    const outer = event("d", "a");
    const inner = event("c", "b");
    const plan = planOf(
      [agentNode("a"), agentNode("b"), agentNode("c"), agentNode("d")],
      [flow("a", "b"), flow("b", "c"), flow("c", "d"), inner, outer],
    );
    expect(planEventOrderIssues(plan, outer)).toEqual([
      { nodeId: "a", port: "event-in", reason: "eventNesting" },
    ]);
    expect(planEventOrderIssues(plan, inner)).toEqual([]);
  });
});

describe("reachability", () => {
  it("follows any chain of edges, event edges included", () => {
    const edges = [flow("a", "b"), event("c", "a"), flow("b", "c")];
    expect(hasPlanReach(edges, "a", "c")).toBe(true);
    expect(hasPlanReach(edges, "c", "b")).toBe(true);
    expect(hasPlanReach(edges, "b", "d")).toBe(false);
    expect(hasPlanReach([], "a", "b")).toBe(false);
  });

  it("stops at a cycle", () => {
    expect(hasPlanReach([flow("a", "b"), flow("b", "a")], "a", "z")).toBe(
      false,
    );
  });
});

describe("nodes that cannot run at the same time", () => {
  it("orders nodes on one path in either direction", () => {
    const edges = [flow("a", "b"), flow("b", "c")];
    expect(arePlanNodesOrdered(edges, "a", "c")).toBe(true);
    expect(arePlanNodesOrdered(edges, "c", "a")).toBe(true);
    expect(
      arePlanNodesOrdered([flow("a", "b"), flow("a", "c")], "b", "c"),
    ).toBe(false);
  });

  it("orders the targets of different outputs of one decision, behind them too", () => {
    const edges = [
      branch("d", "true-out", "yes"),
      branch("d", "false-out", "no"),
      flow("yes", "after-yes"),
    ];
    expect(arePlanNodesOrdered(edges, "yes", "no")).toBe(true);
    expect(arePlanNodesOrdered(edges, "after-yes", "no")).toBe(true);
  });

  it("walks a node behind one output once even when two paths lead to it", () => {
    const edges = [
      branch("d", "true-out", "x"),
      branch("d", "false-out", "y"),
      flow("x", "left"),
      flow("x", "right"),
      flow("left", "join"),
      flow("right", "join"),
      flow("join", "x"),
    ];
    expect(arePlanNodesOrdered(edges, "join", "y")).toBe(true);
    expect(arePlanNodesOrdered(edges, "left", "right")).toBe(true);
  });

  it("orders the targets of different values of a classification", () => {
    const edges = [branch("d", "case:a", "one"), branch("d", "case:b", "two")];
    expect(arePlanNodesOrdered(edges, "one", "two")).toBe(true);
  });

  it("does not order two targets of the same output or nodes behind both outputs", () => {
    const same = [
      branch("d", "true-out", "x"),
      branch("d", "true-out", "y"),
      branch("d", "false-out", "z"),
    ];
    expect(arePlanNodesOrdered(same, "x", "y")).toBe(false);
    const joined = [
      branch("d", "true-out", "x"),
      branch("d", "false-out", "y"),
      flow("x", "join"),
      flow("y", "join"),
    ];
    expect(arePlanNodesOrdered(joined, "join", "x")).toBe(true);
    expect(arePlanNodesOrdered(joined, "join", "other")).toBe(false);
  });

  it("does not let the way back of an event order a branch", () => {
    const edges = [
      branch("d", "true-out", "x"),
      branch("d", "false-out", "y"),
      event("y", "x"),
    ];
    expect(arePlanNodesOrdered(edges, "x", "y")).toBe(true);
    const other = [
      branch("d", "true-out", "x"),
      event("x", "y"),
      branch("d", "false-out", "z"),
    ];
    expect(arePlanNodesOrdered(other, "y", "z")).toBe(false);
  });
});

describe("what an agent needs to report a boolean or receive events", () => {
  function plan(
    step: AgentPlanStep,
    extra: Partial<AgentPlanInput> = {},
  ): AgentPlanInput {
    return {
      ...planOf(
        [step, decision("d"), agentNode("later")],
        [passed(step.id, "d"), flow(step.id, "later"), event("later", step.id)],
      ),
      ...extra,
    };
  }

  it("accepts an ACP agent on the Pages host without a gate", () => {
    expect(planBranchingIssues(plan(agentNode("a")), AGENTS)).toEqual([]);
  });

  it("asks for an ACP provider when neither the node nor its agent has one", () => {
    const bare: AgentPlanStep = { ...agentNode("a"), configuration: undefined };
    expect(
      reasons(planBranchingIssues(plan(bare), [])).filter((entry) =>
        entry.startsWith("a:"),
      ),
    ).toEqual(["a:provider/adapter:branchProvider"]);
    expect(
      planBranchingIssues(plan(bare), [
        choice("agent-1", { provider: "api" as never }),
      ]).some((issue) => issue.reason === "branchProvider"),
    ).toBe(true);
    expect(
      planBranchingIssues(plan(bare), AGENTS).some(
        (issue) => issue.nodeId === "a",
      ),
    ).toBe(false);
  });

  it("refuses a remote agent, whether the node or the plan names the target", () => {
    const remote = { kind: "remote", workspaceId: "w" } as const;
    expect(
      planBranchingIssues(
        plan(agentNode("a", { executionTarget: remote })),
        AGENTS,
      ),
    ).toContainEqual({ nodeId: "a", port: null, reason: "branchRemote" });
    expect(
      planBranchingIssues(
        plan(agentNode("a"), { executionTarget: remote }),
        AGENTS,
      ),
    ).toContainEqual({ nodeId: "a", port: null, reason: "branchRemote" });
    expect(
      planBranchingIssues(
        plan(agentNode("a", { executionTarget: { kind: "local" } }), {
          executionTarget: remote,
        }),
        AGENTS,
      ).some((issue) => issue.reason === "branchRemote"),
    ).toBe(false);
  });

  it("refuses an agent with a completion gate", () => {
    const gated = agentNode("a", {
      completionGate: { version: 1, requiredChecks: [] },
    });
    expect(planBranchingIssues(plan(gated), AGENTS)).toEqual([
      { nodeId: "a", port: null, reason: "branchGate" },
    ]);
  });

  it("asks nothing of an agent that neither reports a boolean nor receives events", () => {
    const bare: AgentPlanStep = { ...agentNode("a"), configuration: undefined };
    const gated: AgentPlanStep = {
      ...bare,
      completionGate: { version: 1, requiredChecks: [] },
    };
    expect(planBranchingIssues(planOf([gated], []), [])).toEqual([]);
  });
});

describe("a group or loop behind the target of an event", () => {
  it("refuses a group and a loop that would have to run again, but not one in front", () => {
    const plan = planOf(
      [
        groupOf("front", []),
        agentNode("a"),
        agentNode("b"),
        groupOf("g", []),
        loopOf("l", []),
      ],
      [
        flow("front", "a"),
        flow("a", "b"),
        flow("b", "g"),
        flow("g", "l"),
        event("b", "a"),
      ],
    );
    expect(
      planBranchingIssues(plan, AGENTS)
        .filter((issue) => issue.reason === "branchBoundary")
        .map((issue) => issue.nodeId),
    ).toEqual(["g", "l"]);
  });
});

describe("edges that cross a group or loop", () => {
  it("accepts decision edges that stay inside one group", () => {
    const group = {
      ...groupOf("g", [agentNode("m")]),
      decisions: [decision("gd")],
      edges: [passed("m", "gd"), branch("gd", "true-out", "m")],
    };
    expect(planBranchingIssues(planOf([group]), AGENTS)).toEqual([]);
  });

  it("refuses a condition from outside into a group and names the node inside", () => {
    const group = {
      ...groupOf("g", [agentNode("m")]),
      decisions: [decision("gd")],
    };
    const plan = planOf([agentNode("a"), group], [passed("a", "gd")]);
    expect(planBranchingIssues(plan, AGENTS)).toContainEqual({
      nodeId: "gd",
      port: "condition-in",
      reason: "branchBoundary",
    });
  });

  it("refuses a branch that leaves a loop and names the source when it ends outside", () => {
    const loop = loopOf("l", [agentNode("m")], [], {
      decisions: [decision("ld")],
    });
    const plan = planOf(
      [loop, agentNode("after")],
      [branch("ld", "true-out", "after")],
    );
    expect(
      planBranchingIssues(plan, AGENTS).filter(
        (issue) => issue.reason === "branchBoundary",
      ),
    ).toEqual([{ nodeId: "ld", port: "true-out", reason: "branchBoundary" }]);
  });

  it("refuses a branch between two different loops and names the target", () => {
    const first = loopOf("l1", [agentNode("m1")], [], {
      decisions: [decision("d1")],
    });
    const second = loopOf("l2", [agentNode("m2")]);
    const plan = planOf([first, second], [branch("d1", "true-out", "m2")]);
    expect(
      planBranchingIssues(plan, AGENTS).filter(
        (issue) => issue.reason === "branchBoundary",
      ),
    ).toEqual([{ nodeId: "m2", port: "flow-in", reason: "branchBoundary" }]);
  });

  it("refuses an event that touches a group, a loop or their members", () => {
    const group = groupOf("g", [agentNode("m")]);
    const loop = loopOf("l", [agentNode("lm")]);
    const plan = planOf(
      [agentNode("a"), group, loop],
      [event("a", "g"), event("a", "l"), event("lm", "a")],
    );
    const boundaries = planBranchingIssues(plan, AGENTS).filter(
      (issue) => issue.reason === "branchBoundary",
    );
    expect(reasons(boundaries)).toEqual([
      "g:event-in:branchBoundary",
      "l:event-in:branchBoundary",
      "lm:value-out:branchBoundary",
    ]);
  });

  it("ignores flow edges and edges of unknown kinds", () => {
    const group = {
      ...groupOf("g", [agentNode("m")]),
      edges: [flow("m", "m"), edgeOf("m", "x", "m", "y")],
    };
    expect(
      planBranchingIssues(
        planOf([agentNode("a"), group], [flow("a", "g")]),
        AGENTS,
      ),
    ).toEqual([]);
  });
});
