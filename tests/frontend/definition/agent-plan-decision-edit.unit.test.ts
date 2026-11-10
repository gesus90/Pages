import { describe, expect, it } from "vitest";

import {
  findPlanDecision,
  placePlanDecision,
  releasedPlanDecisions,
  replacePlanDecision,
  withoutPlanEdges,
  withPlanEdge,
} from "@/definition/AgentPlanDecisionEdit";

import { agent, boundary, groupOf, loopOf, planOf } from "./plan-fixtures";

import type {
  AgentPlanDecision,
  AgentPlanEdge,
  AgentPlanInput,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";

const FLOW_OUT = "flow-out";
const FLOW_IN = "flow-in";

function decision(id: string, x = 0, y = 0): AgentPlanDecision {
  return { id, type: "decision", x, y };
}

function flow(from: string, to: string): AgentPlanEdge {
  return { from, to, fromPort: FLOW_OUT, toPort: FLOW_IN };
}

function branch(from: string, to: string): AgentPlanEdge {
  return { from, to, fromPort: "true-out", toPort: FLOW_IN };
}

function groupWith(
  id: string,
  memberIds: readonly string[],
  extra: Partial<AgentPlanGroup> = {},
): AgentPlanGroup {
  return {
    ...groupOf(
      id,
      memberIds.map((member) => agent(member)),
    ),
    ...extra,
  };
}

function loopWith(
  id: string,
  steps: AgentPlanLoop["steps"],
  extra: Partial<AgentPlanLoop> = {},
): AgentPlanLoop {
  return loopOf(id, steps, [], extra);
}

function nodeById(
  plan: AgentPlanInput,
  id: string,
): AgentPlanInput["nodes"][number] {
  const node = plan.nodes.find((entry) => entry.id === id);
  if (!node) throw new Error(`No node ${id}.`);
  return node;
}

function groupOfPlan(plan: AgentPlanInput, id: string): AgentPlanGroup {
  const node = nodeById(plan, id);
  if (node.type !== "group") throw new Error(`${id} is no group.`);
  return node;
}

function loopOfPlan(plan: AgentPlanInput, id: string): AgentPlanLoop {
  const node = nodeById(plan, id);
  if (node.type !== "loop") throw new Error(`${id} is no loop.`);
  return node;
}

describe("finding a decision", () => {
  const top = decision("top");
  const inGroup = decision("in-group");
  const inLoop = decision("in-loop");
  const inLoopGroup = decision("in-loop-group");
  const plan = planOf([
    agent("worker"),
    top,
    groupWith("group", ["a"], { decisions: [inGroup] }),
    groupWith("plain", ["b"]),
    loopWith(
      "loop",
      [groupWith("inner", ["c"], { decisions: [inLoopGroup] })],
      { decisions: [inLoop] },
    ),
  ]);

  it("finds a decision at the top level", () => {
    expect(findPlanDecision(plan, "top")).toEqual({
      decision: top,
      place: { kind: "top" },
    });
  });

  it("finds a decision of a group and names the group", () => {
    expect(findPlanDecision(plan, "in-group")).toEqual({
      decision: inGroup,
      place: { kind: "group", groupId: "group" },
    });
  });

  it("finds a decision of a loop and names the loop", () => {
    expect(findPlanDecision(plan, "in-loop")).toEqual({
      decision: inLoop,
      place: { kind: "loop", loopId: "loop" },
    });
  });

  it("assigns a decision of a group inside a loop to the loop", () => {
    expect(findPlanDecision(plan, "in-loop-group")).toEqual({
      decision: inLoopGroup,
      place: { kind: "loop", loopId: "loop" },
    });
  });

  it("returns null for an id no decision has, an agent included", () => {
    expect(findPlanDecision(plan, "missing")).toBeNull();
    expect(findPlanDecision(plan, "worker")).toBeNull();
  });
});

describe("replacing a decision", () => {
  const changed = (id: string): AgentPlanDecision => ({
    ...decision(id, 5, 6),
    name: "Changed",
  });

  it("replaces a decision at the top level and keeps the other nodes", () => {
    const worker = agent("worker");
    const plan = planOf([worker, decision("top"), decision("other")]);
    const result = replacePlanDecision(plan, changed("top"));
    expect(result.nodes).toEqual([worker, changed("top"), decision("other")]);
  });

  it("replaces a decision of a group without touching its other decisions", () => {
    const plan = planOf([
      groupWith("group", ["a"], {
        decisions: [decision("d1"), decision("d2")],
      }),
    ]);
    const result = replacePlanDecision(plan, changed("d2"));
    expect(groupOfPlan(result, "group").decisions).toEqual([
      decision("d1"),
      changed("d2"),
    ]);
  });

  it("replaces a decision of a loop and one of a group inside the loop", () => {
    const plan = planOf([
      loopWith(
        "loop",
        [
          agent("member"),
          groupWith("inner", ["c"], { decisions: [decision("deep")] }),
        ],
        { decisions: [decision("shallow")] },
      ),
    ]);
    const shallow = replacePlanDecision(plan, changed("shallow"));
    expect(loopOfPlan(shallow, "loop").decisions).toEqual([changed("shallow")]);
    const deep = replacePlanDecision(plan, changed("deep"));
    const inner = loopOfPlan(deep, "loop").steps[1];
    expect(inner?.type === "group" ? inner.decisions : null).toEqual([
      changed("deep"),
    ]);
    expect(loopOfPlan(deep, "loop").decisions).toEqual([decision("shallow")]);
  });

  it("leaves a plan alone when no decision has the id", () => {
    const plan = planOf([
      groupWith("group", ["a"]),
      loopWith("loop", [agent("member")]),
      decision("top"),
    ]);
    const result = replacePlanDecision(plan, changed("missing"));
    expect(result).toEqual(plan);
    expect(groupOfPlan(result, "group")).not.toHaveProperty("decisions");
  });
});

describe("releasing the decisions of a dissolved container", () => {
  it("moves each decision by the offset of the member area", () => {
    expect(
      releasedPlanDecisions([decision("a", 1, 2), decision("b", 10, 20)], {
        x: 100,
        y: 200,
      }),
    ).toEqual([decision("a", 101, 202), decision("b", 110, 220)]);
  });

  it("releases nothing for a container without decisions", () => {
    expect(releasedPlanDecisions(undefined, { x: 5, y: 5 })).toEqual([]);
  });
});

describe("moving a decision into a group", () => {
  const plan = planOf(
    [
      boundary("start", "start"),
      decision("d", 1, 1),
      groupWith("g", ["a", "b"]),
      agent("outer"),
    ],
    [flow("start", "d"), branch("d", "a"), flow("d", "outer")],
  );

  it("places it at the new position, keeps what may stay and drops the rest", () => {
    const moved = placePlanDecision(plan, {
      decisionId: "d",
      frameId: "g",
      position: { x: 40, y: 50 },
    });
    expect(moved?.removedEdges).toBe(0);
    const result = moved?.plan;
    if (!result) throw new Error("The move must succeed.");
    expect(result.nodes.some((node) => node.id === "d")).toBe(false);
    expect(groupOfPlan(result, "g").decisions).toEqual([decision("d", 40, 50)]);
    // A flow edge may join a group member and an outer node; the branch edge
    // joins two nodes of the group and moves into it, behind the member chain.
    expect(result.edges).toEqual([flow("start", "d"), flow("d", "outer")]);
    expect(groupOfPlan(result, "g").edges).toEqual([
      flow("a", "b"),
      branch("d", "a"),
    ]);
  });

  it("keeps the decision's other fields when it moves", () => {
    const named: AgentPlanDecision = { ...decision("d", 1, 1), name: "Gate" };
    const result = placePlanDecision(planOf([named, groupWith("g", ["a"])]), {
      decisionId: "d",
      frameId: "g",
      position: { x: 7, y: 8 },
    });
    expect(groupOfPlan(result?.plan ?? planOf([]), "g").decisions).toEqual([
      { ...named, x: 7, y: 8 },
    ]);
  });

  it("drops a branch edge to a node that stays outside the group", () => {
    const outside = planOf(
      [decision("d"), groupWith("g", ["a"]), agent("outer")],
      [branch("d", "outer")],
    );
    const moved = placePlanDecision(outside, {
      decisionId: "d",
      frameId: "g",
      position: { x: 0, y: 0 },
    });
    expect(moved?.removedEdges).toBe(1);
    expect(moved?.plan.edges).toEqual([]);
  });
});

describe("moving a decision into a loop", () => {
  const plan = planOf(
    [
      boundary("start", "start"),
      decision("d"),
      loopWith("loop", [agent("a")], { edges: [flow("a", "a2")] }),
    ],
    [flow("start", "d"), branch("d", "a")],
  );

  it("drops a flow edge that would cross the border of the loop", () => {
    const moved = placePlanDecision(plan, {
      decisionId: "d",
      frameId: "loop",
      position: { x: 3, y: 4 },
    });
    expect(moved?.removedEdges).toBe(1);
    const result = moved?.plan;
    if (!result) throw new Error("The move must succeed.");
    expect(result.edges).toEqual([]);
    const loop = loopOfPlan(result, "loop");
    expect(loop.decisions).toEqual([decision("d", 3, 4)]);
    expect(loop.edges).toEqual([flow("a", "a2"), branch("d", "a")]);
  });

  it("appends to the decisions a loop already holds", () => {
    const withOne = planOf([
      decision("d"),
      loopWith("loop", [agent("a")], { decisions: [decision("held")] }),
    ]);
    const moved = placePlanDecision(withOne, {
      decisionId: "d",
      frameId: "loop",
      position: { x: 0, y: 0 },
    });
    expect(loopOfPlan(moved?.plan ?? withOne, "loop").decisions).toEqual([
      decision("held"),
      decision("d"),
    ]);
  });
});

describe("moving a decision out to the top level", () => {
  const inGroup = planOf(
    [
      groupWith("g", ["a", "b"], {
        decisions: [decision("d", 10, 10)],
        edges: [flow("d", "a"), branch("d", "b"), flow("a", "b")],
      }),
      boundary("end", "end"),
    ],
    [],
  );

  it("keeps a flow edge as an outer edge and drops a branch edge", () => {
    const moved = placePlanDecision(inGroup, {
      decisionId: "d",
      frameId: null,
      position: { x: 200, y: 300 },
    });
    expect(moved?.removedEdges).toBe(1);
    const result = moved?.plan;
    if (!result) throw new Error("The move must succeed.");
    expect(result.nodes.at(-1)).toEqual(decision("d", 200, 300));
    expect(result.edges).toEqual([flow("d", "a")]);
    const group = groupOfPlan(result, "g");
    expect(group.edges).toEqual([flow("a", "b")]);
    expect(group).toHaveProperty("decisions", undefined);
  });

  it("drops the condition edge of an agent into the decision", () => {
    const plan = planOf(
      [
        groupWith("g", ["a"], {
          decisions: [decision("d")],
          edges: [
            {
              from: "a",
              to: "d",
              fromPort: "passed-out",
              toPort: "condition-in",
            },
          ],
        }),
      ],
      [],
    );
    const moved = placePlanDecision(plan, {
      decisionId: "d",
      frameId: null,
      position: { x: 0, y: 0 },
    });
    expect(moved?.removedEdges).toBe(1);
    expect(groupOfPlan(moved?.plan ?? plan, "g").edges).toEqual([]);
  });

  it("drops an edge with an unknown kind", () => {
    const plan = planOf(
      [
        groupWith("g", ["a"], {
          decisions: [decision("d")],
          edges: [
            { from: "a", to: "d", fromPort: "odd-out", toPort: "odd-in" },
          ],
        }),
      ],
      [],
    );
    expect(
      placePlanDecision(plan, {
        decisionId: "d",
        frameId: null,
        position: { x: 0, y: 0 },
      })?.removedEdges,
    ).toBe(1);
  });

  it("takes a decision out of a group inside a loop and cleans every edge list", () => {
    const inner = groupWith("inner", ["x"], {
      decisions: [decision("d")],
      edges: [flow("d", "x")],
    });
    const plan = planOf(
      [
        loopWith("loop", [inner, agent("y")], {
          edges: [flow("x", "y"), branch("d", "y")],
        }),
      ],
      [],
    );
    const moved = placePlanDecision(plan, {
      decisionId: "d",
      frameId: null,
      position: { x: 9, y: 9 },
    });
    // Both flow edges would cross the loop's border, so both are dropped.
    expect(moved?.removedEdges).toBe(2);
    const loop = loopOfPlan(moved?.plan ?? plan, "loop");
    expect(loop.edges).toEqual([flow("x", "y")]);
    const group = loop.steps[0];
    expect(group?.type === "group" ? group.edges : null).toEqual([]);
    expect(moved?.plan.nodes.at(-1)).toEqual(decision("d", 9, 9));
  });
});

describe("moving a decision within its container", () => {
  it("keeps every edge in the group both ends share", () => {
    const plan = planOf([
      groupWith("g", ["a"], {
        decisions: [decision("d")],
        edges: [branch("d", "a")],
      }),
    ]);
    const moved = placePlanDecision(plan, {
      decisionId: "d",
      frameId: "g",
      position: { x: 60, y: 70 },
    });
    expect(moved?.removedEdges).toBe(0);
    const group = groupOfPlan(moved?.plan ?? plan, "g");
    expect(group.decisions).toEqual([decision("d", 60, 70)]);
    expect(group.edges).toEqual([branch("d", "a")]);
  });

  it("keeps the outer edges of a decision that stays at the top level", () => {
    const plan = planOf(
      [decision("d"), agent("a")],
      [flow("a", "d"), branch("d", "a")],
    );
    const moved = placePlanDecision(plan, {
      decisionId: "d",
      frameId: null,
      position: { x: 1, y: 2 },
    });
    expect(moved?.removedEdges).toBe(0);
    expect(moved?.plan.edges).toEqual([flow("a", "d"), branch("d", "a")]);
  });
});

describe("refusing to move a decision", () => {
  const plan = planOf([decision("d"), agent("worker"), groupWith("g", ["a"])]);
  const position = { x: 0, y: 0 };

  it("returns null when the decision does not exist", () => {
    expect(
      placePlanDecision(plan, { decisionId: "x", frameId: "g", position }),
    ).toBeNull();
  });

  it("returns null when the frame does not exist", () => {
    expect(
      placePlanDecision(plan, { decisionId: "d", frameId: "nope", position }),
    ).toBeNull();
  });

  it("returns null when the frame is neither a group nor a loop", () => {
    expect(
      placePlanDecision(plan, {
        decisionId: "d",
        frameId: "worker",
        position,
      }),
    ).toBeNull();
  });
});

describe("adding an edge where its ends belong", () => {
  const plan = planOf(
    [
      boundary("start", "start"),
      groupWith("g", ["a", "b"], { decisions: [decision("d")] }),
      groupWith("h", ["c"]),
      loopWith("loop", [agent("x"), agent("y")], {
        decisions: [decision("e")],
      }),
      agent("outer"),
    ],
    [],
  );

  it("keeps an edge inside the group both ends share", () => {
    const result = withPlanEdge(plan, branch("d", "a"));
    expect(result.edges).toEqual([]);
    expect(groupOfPlan(result, "g").edges).toEqual([
      flow("a", "b"),
      branch("d", "a"),
    ]);
  });

  it("keeps an edge inside the loop both ends share", () => {
    const result = withPlanEdge(plan, branch("e", "y"));
    expect(result.edges).toEqual([]);
    expect(loopOfPlan(result, "loop").edges).toEqual([branch("e", "y")]);
  });

  it("puts an edge between two containers on the outer edges", () => {
    const result = withPlanEdge(plan, flow("a", "c"));
    expect(result.edges).toEqual([flow("a", "c")]);
    expect(groupOfPlan(result, "g")).toEqual(groupOfPlan(plan, "g"));
  });

  it("puts an edge from the top level into a container on the outer edges", () => {
    expect(withPlanEdge(plan, flow("start", "a")).edges).toEqual([
      flow("start", "a"),
    ]);
    expect(withPlanEdge(plan, flow("x", "outer")).edges).toEqual([
      flow("x", "outer"),
    ]);
  });

  it("puts an edge between two top level nodes on the outer edges", () => {
    expect(withPlanEdge(plan, flow("start", "outer")).edges).toEqual([
      flow("start", "outer"),
    ]);
  });
});

describe("removing edges wherever they are kept", () => {
  const plan = planOf(
    [
      groupWith("explicit", ["a", "b"], {
        edges: [flow("a", "b"), branch("d", "a")],
      }),
      groupWith("chained", ["c", "e"]),
      loopWith(
        "loop",
        [
          agent("x"),
          groupWith("inner", ["y", "z"], {
            edges: [flow("y", "z"), flow("z", "y2")],
          }),
          groupWith("bare", ["w"]),
        ],
        { edges: [flow("x", "y"), flow("y", "z")] },
      ),
      agent("plain"),
    ],
    [flow("start", "a"), flow("a", "plain")],
  );

  it("removes the matching edges of the outer plan, groups and loops", () => {
    const result = withoutPlanEdges(
      plan,
      (edge) => edge.from === "a" || edge.to === "y",
    );
    expect(result.edges).toEqual([flow("start", "a")]);
    expect(groupOfPlan(result, "explicit").edges).toEqual([branch("d", "a")]);
    const loop = loopOfPlan(result, "loop");
    expect(loop.edges).toEqual([flow("y", "z")]);
    const inner = loop.steps[1];
    expect(inner?.type === "group" ? inner.edges : null).toEqual([
      flow("y", "z"),
      flow("z", "y2"),
    ]);
  });

  it("removes edges of a group inside a loop", () => {
    const result = withoutPlanEdges(plan, (edge) => edge.to === "y2");
    const inner = loopOfPlan(result, "loop").steps[1];
    expect(inner?.type === "group" ? inner.edges : null).toEqual([
      flow("y", "z"),
    ]);
  });

  it("leaves groups without saved edges and plain nodes as they are", () => {
    const result = withoutPlanEdges(plan, () => true);
    expect(groupOfPlan(result, "chained")).toBe(groupOfPlan(plan, "chained"));
    expect(nodeById(result, "plain")).toBe(nodeById(plan, "plain"));
    const loop = loopOfPlan(result, "loop");
    expect(loop.edges).toEqual([]);
    expect(loop.steps[2]).toBe(loopOfPlan(plan, "loop").steps[2]);
    expect(loop.steps[0]).toBe(loopOfPlan(plan, "loop").steps[0]);
    expect(result.edges).toEqual([]);
  });

  it("keeps every edge when none matches", () => {
    const result = withoutPlanEdges(plan, () => false);
    expect(result.edges).toEqual(plan.edges);
    expect(groupOfPlan(result, "explicit").edges).toEqual(
      groupOfPlan(plan, "explicit").edges,
    );
  });
});
