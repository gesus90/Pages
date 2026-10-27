import { describe, expect, it } from "vitest";

import {
  PLAN_LOOP_PATH_LENGTH,
  PLAN_LOOP_PATH_SEGMENTS,
  PLAN_LOOP_RUNS,
  allPlanLoopMembers,
  emptyPlanLoop,
  expandPlanLoops,
  isPlanLoopConditionActive,
  isPlanLoopRuns,
  parsePlanLoopPath,
  planLoopEdges,
  planLoopEntries,
  planLoopExits,
  planLoopOf,
  readPlanLoopRunsText,
} from "@/definition/AgentPlanLoop";

import { agent, edge, loopOf, planOf, script } from "./plan-fixtures";

import type { AgentPlanLoopCondition } from "@/definition/AgentPlanLoop";

const CONDITION: AgentPlanLoopCondition = {
  isEnabled: true,
  sourceNodeId: "a",
  outputPath: "$.done",
  operator: "equals",
  expected: { type: "boolean", value: true },
};

describe("reading a loop path", () => {
  it.each([
    { path: "$.end", segments: ["end"] },
    { path: "$.review.end", segments: ["review", "end"] },
    { path: "$.items[0].done", segments: ["items", 0, "done"] },
    { path: "$[12]", segments: [12] },
    { path: "$._a1", segments: ["_a1"] },
  ])("reads $path", ({ path, segments }) => {
    expect(parsePlanLoopPath(path)).toEqual(segments);
  });

  it.each([
    "",
    "$",
    "end",
    "$.",
    "$..end",
    "$.1a",
    "$.a-b",
    "$[1000]",
    "$[-1]",
    "$[*]",
    "$.a b",
    `$.${"a".repeat(65)}`,
    `$.${"a".repeat(PLAN_LOOP_PATH_LENGTH)}`,
    `$${".a".repeat(PLAN_LOOP_PATH_SEGMENTS + 1)}`,
  ])("refuses “%s”", (path) => {
    expect(parsePlanLoopPath(path)).toBeNull();
  });

  it("accepts as many segments as allowed", () => {
    expect(
      parsePlanLoopPath(`$${".a".repeat(PLAN_LOOP_PATH_SEGMENTS)}`),
    ).toHaveLength(PLAN_LOOP_PATH_SEGMENTS);
  });
});

describe("the number of iterations", () => {
  it("accepts whole numbers from one to 999 only", () => {
    expect(isPlanLoopRuns(PLAN_LOOP_RUNS.minimum)).toBe(true);
    expect(isPlanLoopRuns(PLAN_LOOP_RUNS.maximum)).toBe(true);
    for (const runs of [0, 1000, 1.5, -1, Number.NaN, "5", null, undefined])
      expect(isPlanLoopRuns(runs)).toBe(false);
  });

  it("reads a count from plain decimal digits only", () => {
    expect(readPlanLoopRunsText("1")).toBe(1);
    expect(readPlanLoopRunsText("999")).toBe(999);
    for (const text of [
      "",
      "0",
      "01",
      "1000",
      "+5",
      "-5",
      "5.0",
      " 5",
      "5 ",
      "1e2",
    ])
      expect(readPlanLoopRunsText(text)).toBeNull();
  });
});

describe("the end condition", () => {
  it("counts only when it is enabled and the loop counts at most", () => {
    expect(
      isPlanLoopConditionActive({ countMode: "max", condition: CONDITION }),
    ).toBe(true);
    expect(
      isPlanLoopConditionActive({
        countMode: "expected",
        condition: CONDITION,
      }),
    ).toBe(false);
    expect(
      isPlanLoopConditionActive({
        countMode: "max",
        condition: { ...CONDITION, isEnabled: false },
      }),
    ).toBe(false);
    expect(
      isPlanLoopConditionActive({ countMode: "max", condition: null }),
    ).toBe(false);
  });
});

describe("the structure of a loop", () => {
  const loop = loopOf(
    "loop",
    [agent("a"), agent("b"), script("c"), agent("d")],
    [edge("a", "b"), edge("a", "c"), edge("b", "d")],
  );

  it("starts empty with one iteration that counts at most and keeps its sessions", () => {
    expect(emptyPlanLoop("l", "Loop", { x: 3, y: 4 })).toEqual({
      id: "l",
      type: "loop",
      name: "Loop",
      x: 3,
      y: 4,
      steps: [],
      edges: [],
      runs: 1,
      runsSource: "value",
      bindings: {},
      countMode: "max",
      sessionPolicy: "reuse",
      condition: null,
    });
  });

  it("enters through the members without a predecessor and leaves through those without a successor", () => {
    expect(planLoopEntries(loop).map((step) => step.id)).toEqual(["a"]);
    expect(planLoopExits(loop).map((step) => step.id)).toEqual(["c", "d"]);
    expect(planLoopEdges(loop)).toBe(loop.edges);
  });

  it("finds the loop of a member and every member of every loop", () => {
    const plan = planOf([agent("outer"), loop, loopOf("second", [agent("z")])]);

    expect(planLoopOf(plan, "c")?.id).toBe("loop");
    expect(planLoopOf(plan, "z")?.id).toBe("second");
    expect(planLoopOf(plan, "outer")).toBeUndefined();
    expect(allPlanLoopMembers(plan).map((member) => member.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "z",
    ]);
  });
});

describe("expanding loops", () => {
  it("returns a plan without loops unchanged", () => {
    const plan = planOf([agent("a")], []);

    expect(expandPlanLoops(plan)).toBe(plan);
  });

  it("replaces a loop by its members and wires the outer edges to its entries and exits", () => {
    const plan = planOf(
      [
        agent("before"),
        loopOf("loop", [agent("a"), agent("b"), agent("c")], [edge("a", "b")]),
        agent("after"),
      ],
      [edge("before", "loop"), edge("loop", "after"), edge("before", "after")],
    );

    const expanded = expandPlanLoops(plan);

    expect(expanded.nodes.map((node) => node.id)).toEqual([
      "before",
      "a",
      "b",
      "c",
      "after",
    ]);
    expect(expanded.edges.map((entry) => `${entry.from}>${entry.to}`)).toEqual([
      "before>a",
      "before>c",
      "b>after",
      "c>after",
      "before>after",
      "a>b",
    ]);
  });

  it("connects two loops through the exits of the first and the entries of the second", () => {
    const plan = planOf(
      [loopOf("one", [agent("a")]), loopOf("two", [agent("b")])],
      [edge("one", "two")],
    );

    expect(
      expandPlanLoops(plan).edges.map((entry) => `${entry.from}>${entry.to}`),
    ).toEqual(["a>b"]);
  });
});
