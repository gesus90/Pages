import { describe, expect, it } from "vitest";

import { PLAN_ACTIVATION_LIMIT } from "@/definition/AgentPlanBranching";
import { planSequenceContext } from "@/app/components/agents/plans/plan-step-sequence-context";
import { outlookSequenceBlocks } from "@/app/components/agents/plans/plan-step-sequence-outlook";

import { syntheticRun } from "../page72-run-fixture";
import {
  branchEdge,
  conditionEdge,
  DECISION,
  eventEdge,
  reviewCyclePlan,
} from "./plan-branching-fixture";
import { agentNode, flowEdge, planOf } from "./plan-group-fixture";
import { loopIteration, loopMember, syntheticLoop } from "./plan-loop-fixture";
import { runStep } from "./plan-panel-fixture";

import type {
  AgentPlanInput,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type {
  AgentPlanLoopIteration,
  AgentPlanLoopRun,
} from "@/definition/AgentPlanLoopRun";

const START = { id: "start", type: "start", x: 0, y: 0 } as const;
const END = { id: "end", type: "end", x: 1000, y: 0 } as const;

function runOf(
  steps: readonly AgentPlanStepResult[],
  overrides: Partial<AgentPlanRun> = {},
): AgentPlanRun {
  return { ...syntheticRun(), steps, ...overrides };
}

/** The outlook as `key:kind` pairs; the label of a node without a record is its id. */
function outlook(
  plan: AgentPlanInput,
  run: AgentPlanRun | null = null,
): readonly string[] {
  return outlookSequenceBlocks(
    planSequenceContext(run, plan, (node) => node.id),
  ).map((block) => `${block.key}:${block.kind}`);
}

/**
 * Start → check → decision; true leads to ship, false to fix. Both end the plan.
 */
function branchingPlan(): AgentPlanInput {
  return planOf(
    [
      START,
      agentNode("check", "codex"),
      DECISION,
      agentNode("ship", "codex"),
      agentNode("fix", "codex"),
      END,
    ],
    [
      flowEdge("start", "check"),
      conditionEdge("check", "decision"),
      branchEdge("decision", "true", "ship"),
      branchEdge("decision", "false", "fix"),
      flowEdge("ship", "end"),
      flowEdge("fix", "end"),
    ],
  );
}

describe("a plan before any decision was taken", () => {
  it("plans every agent of a straight line and leaves out those that already started", () => {
    const plan = planOf(
      [START, agentNode("one", "codex"), agentNode("two", "codex"), END],
      [
        flowEdge("start", "one"),
        flowEdge("one", "two"),
        flowEdge("two", "end"),
      ],
    );

    expect(outlook(plan)).toEqual(["one#1:planned", "two#1:planned"]);
    expect(
      outlook(plan, runOf([runStep("one", { status: "running" })])),
    ).toEqual(["two#1:planned"]);
  });

  it("expects an open decision to pass: its true branch is assumed, its false branch is out", () => {
    expect(outlook(branchingPlan())).toEqual([
      "check#1:planned",
      "ship#1:assumed",
    ]);
  });

  it("takes the waiting record of a block into its result and names it by the record", () => {
    const waiting = runStep("check", { name: "Recorded check" });
    const [block] = outlookSequenceBlocks(
      planSequenceContext(runOf([waiting]), branchingPlan(), (node) => node.id),
    );

    expect(block?.name).toBe("Recorded check");
    expect(block?.result).toBe(waiting);
  });
});

describe("a decision that was taken", () => {
  const passed = (branch: "true" | "false"): readonly AgentPlanStepResult[] => [
    runStep("check", { status: "succeeded", activation: 1 }),
    runStep("decision", { status: "succeeded", branch }),
  ];

  it("keeps only the branch it activated", () => {
    expect(outlook(branchingPlan(), runOf(passed("true")))).toEqual([
      "ship#1:planned",
    ]);
    expect(outlook(branchingPlan(), runOf(passed("false")))).toEqual([
      "fix#1:planned",
    ]);
  });

  it("treats an edge that leaves a decision outside its branches as live", () => {
    const plan = planOf(
      [
        START,
        agentNode("check", "codex"),
        DECISION,
        agentNode("after", "codex"),
      ],
      [
        flowEdge("start", "check"),
        conditionEdge("check", "decision"),
        flowEdge("decision", "after"),
      ],
    );

    expect(outlook(plan, runOf(passed("true")))).toEqual(["after#1:planned"]);
  });

  it("drops everything behind a skipped source", () => {
    const skipped = runOf([runStep("check", { status: "skipped" })]);

    expect(outlook(branchingPlan(), skipped)).toEqual([]);
  });

  it("drops what follows a stack that handed over nothing and keeps it after an entry", () => {
    const plan = planOf(
      [
        START,
        {
          id: "stack",
          type: "stack",
          name: "Inputs",
          x: 100,
          y: 0,
          entries: [],
        },
        agentNode("worker", "codex"),
        END,
      ],
      [
        flowEdge("start", "stack"),
        flowEdge("stack", "worker"),
        flowEdge("worker", "end"),
      ],
    );
    const handed = (entryId: string | null): AgentPlanRun =>
      runOf([
        runStep("stack", {
          status: "succeeded",
          stack: { entryId, position: entryId ? 1 : 0, total: 1 },
        }),
      ]);

    expect(outlook(plan, handed(null))).toEqual([]);
    expect(outlook(plan, handed("entry-1"))).toEqual(["worker#1:planned"]);
  });
});

describe("a run that ended", () => {
  it("keeps only what it planned and never reached", () => {
    const ended = runOf(
      [runStep("check", { status: "succeeded", activation: 1 })],
      { status: "failed" },
    );

    expect(outlook(branchingPlan(), runOf([], { status: "failed" }))).toEqual([
      "check#1:planned",
    ]);
    expect(outlook(branchingPlan(), ended)).toEqual([]);
  });
});

describe("a cycle that an event closes", () => {
  /** The cycle of the review plan with an extra agent behind the true branch. */
  function cyclePlan(): AgentPlanInput {
    const plan = reviewCyclePlan();
    return planOf(
      [...plan.nodes, agentNode("ship", "codex", { x: 800, y: -300 })],
      [
        ...plan.edges.filter((edge) => edge.to !== "end"),
        branchEdge("decision", "true", "ship"),
        flowEdge("ship", "end"),
      ],
    );
  }

  const checked = runStep("check", { status: "succeeded", activation: 1 });

  it("counts the first start of a target that has no record yet", () => {
    const run = runOf([runStep("fix", { status: "running" })]);

    expect(outlook(reviewCyclePlan(), run)).toContain("check#2:assumed");
  });

  it("assumes another round while a sender of the event runs", () => {
    const run = runOf([checked, runStep("fix", { status: "running" })]);

    expect(outlook(reviewCyclePlan(), run)).toEqual(["check#2:assumed"]);
  });

  it("numbers the repeated nodes after the blocks the current round already planned", () => {
    const run = runOf([checked, runStep("fix", { status: "running" })]);

    expect(outlook(cyclePlan(), run)).toEqual([
      "ship#1:assumed",
      "check#2:assumed",
      "ship#2:assumed",
    ]);
  });

  it("expects another round from a waiting sender that surely runs", () => {
    const run = runOf([
      checked,
      runStep("decision", { status: "succeeded", branch: "false" }),
      runStep("fix"),
    ]);

    expect(outlook(reviewCyclePlan(), run)).toEqual([
      "fix#1:planned",
      "check#2:assumed",
    ]);
  });

  it("expects no further round from a blocked sender", () => {
    const run = runOf([
      checked,
      runStep("decision", { status: "succeeded", branch: "false" }),
      runStep("fix", { isBlocked: true }),
    ]);

    expect(outlook(reviewCyclePlan(), run)).toEqual(["fix#1:planned"]);
  });

  it("expects no further round from a sender that lies on an expected branch only", () => {
    expect(
      outlook(reviewCyclePlan(), runOf([checked, runStep("fix")])),
    ).toEqual([]);
  });

  it("stops repeating once the target reached the limit of starts", () => {
    const run = runOf([
      runStep("check", {
        status: "succeeded",
        activation: PLAN_ACTIVATION_LIMIT,
      }),
      runStep("fix", { status: "running" }),
    ]);

    expect(outlook(reviewCyclePlan(), run)).toEqual([]);
  });

  it("starts a further round from an event that nothing has sent yet", () => {
    const plan = planOf(
      [START, agentNode("check", "codex"), agentNode("fix", "codex"), END],
      [
        flowEdge("start", "check"),
        flowEdge("check", "fix"),
        eventEdge("fix", "check"),
        flowEdge("fix", "end"),
      ],
    );
    const done = runOf([
      runStep("check", { status: "succeeded", activation: 1 }),
      runStep("fix", { status: "succeeded", activation: 1 }),
    ]);

    expect(outlook(plan, done)).toEqual(["check#2:assumed", "fix#2:assumed"]);
  });
});

describe("a loop", () => {
  const members = [
    loopMember("first", "codex", { x: 0, y: 0 }),
    loopMember("second", "codex", { x: 200, y: 0 }),
  ];

  function loopingPlan(loop: AgentPlanLoop): AgentPlanInput {
    return planOf(
      [START, loop, END],
      [flowEdge("start", "loop"), flowEdge("loop", "end")],
    );
  }

  function recordOf(
    iterations: readonly AgentPlanLoopIteration[],
    overrides: Partial<AgentPlanLoopRun> = {},
  ): AgentPlanLoopRun {
    return {
      id: "loop",
      name: "Review loop",
      status: "running",
      count: { source: "value", parameterId: null, effective: 3, mode: "max" },
      sessionPolicy: "reuse",
      condition: null,
      iterations,
      sessions: [],
      completion: null,
      cleanup: "not_needed",
      startedAt: "2026-10-15T10:00:00.000Z",
      endedAt: null,
      error: null,
      ...overrides,
    };
  }

  const unfinished = (
    nodes: AgentPlanStepResult[],
  ): AgentPlanLoopIteration => ({
    ...loopIteration(2, { state: "not_evaluated", reason: "disabled" }),
    endedAt: null,
    nodes,
  });

  it("plans every iteration of a counted loop before it starts", () => {
    const plan = loopingPlan(syntheticLoop({ runs: 2, steps: members }));

    expect(outlook(plan)).toEqual([
      "loop#1/first:planned",
      "loop#1/second:planned",
      "loop#2/first:planned",
      "loop#2/second:planned",
    ]);
  });

  it("is sure of the first iteration only when an end condition may stop the loop", () => {
    const plan = loopingPlan(
      syntheticLoop({
        runs: 3,
        steps: [members[0]!],
        condition: {
          isEnabled: true,
          sourceNodeId: "first",
          outputPath: "passed",
          expected: true,
        },
      }),
    );

    expect(outlook(plan)).toEqual([
      "loop#1/first:planned",
      "loop#2/first:assumed",
      "loop#3/first:assumed",
    ]);
  });

  it("makes a loop behind an open decision assumed", () => {
    const plan = planOf(
      [
        START,
        agentNode("check", "codex"),
        DECISION,
        syntheticLoop({ runs: 1, steps: [members[0]!] }),
        END,
      ],
      [
        flowEdge("start", "check"),
        conditionEdge("check", "decision"),
        branchEdge("decision", "true", "loop"),
        flowEdge("loop", "end"),
      ],
    );

    expect(outlook(plan)).toEqual(["check#1:planned", "loop#1/first:assumed"]);
  });

  it("continues the running iteration with the members that have not started and the iterations still to come", () => {
    const plan = loopingPlan(syntheticLoop({ steps: members }));
    const waitingSecond = runStep("second", { name: "Second member" });
    const run = runOf([], {
      loops: [
        recordOf([
          loopIteration(1, { state: "not_evaluated", reason: "disabled" }),
          unfinished([runStep("first", { status: "running" }), waitingSecond]),
        ]),
      ],
    });
    const blocks = outlookSequenceBlocks(
      planSequenceContext(run, plan, (node) => node.id),
    );

    expect(blocks.map((block) => `${block.key}:${block.kind}`)).toEqual([
      "loop#2/second:planned",
      "loop#3/first:planned",
      "loop#3/second:planned",
    ]);
    expect(blocks[0]?.name).toBe("Second member");
    expect(blocks[0]?.result).toBe(waitingSecond);
    expect(blocks[0]?.isLoopPass).toBe(true);
    expect(blocks[0]?.pass).toBe(2);
  });

  it("skips members of the running iteration that are skipped or have no record", () => {
    const plan = loopingPlan(syntheticLoop({ steps: members }));
    const run = runOf([], {
      loops: [
        recordOf([unfinished([runStep("first", { status: "skipped" })])], {
          count: {
            source: "value",
            parameterId: null,
            effective: 2,
            mode: "max",
          },
        }),
      ],
    });

    expect(outlook(plan, run)).toEqual([
      "loop#2/first:planned",
      "loop#2/second:planned",
    ]);
  });

  it("expects nothing after the loop ended and no rest of an iteration once the run is no longer active", () => {
    const plan = loopingPlan(syntheticLoop({ steps: members }));
    const ended = runOf([], {
      loops: [recordOf([], { status: "succeeded" })],
    });
    const halted = runOf([], {
      status: "failed",
      loops: [recordOf([unfinished([runStep("second")])])],
    });

    expect(outlook(plan, ended)).toEqual([]);
    expect(outlook(plan, halted)).toEqual([
      "loop#2/first:planned",
      "loop#2/second:planned",
      "loop#3/first:planned",
      "loop#3/second:planned",
    ]);
  });
});
