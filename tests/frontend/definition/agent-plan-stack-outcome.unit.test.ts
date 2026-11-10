import { describe, expect, it } from "vitest";

import {
  hasOpenPlanStepReport,
  planStackOutcome,
  planStackParticipants,
} from "@/definition/AgentPlanStackOutcome";
import { emptyPlanStack } from "@/definition/AgentPlanStack";

import { syntheticSession } from "../app/components/agents/page72-run-fixture";
import { agent, groupOf, loopOf, planOf, script } from "./plan-fixtures";

import type {
  AgentPlanBinding,
  AgentPlanEdge,
  AgentPlanNode,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";
import type { AgentPlanStackRun } from "@/definition/AgentPlanStack";

type RunView = Pick<AgentPlanRun, "status" | "steps" | "loops" | "stacks">;

const CONTENT: AgentPlanBinding = {
  kind: "stack",
  stackId: "stack",
  output: "content",
};
const STACK = emptyPlanStack("stack", "Stack", { x: 0, y: 0 });

function trigger(to: string): AgentPlanEdge {
  return { from: "stack", to, fromPort: "flow-out", toPort: "flow-in" };
}

function result(
  id: string,
  overrides: Partial<AgentPlanStepResult> = {},
): AgentPlanStepResult {
  return {
    id,
    name: id,
    status: "succeeded",
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: null,
    ...overrides,
  };
}

function withVerdict(
  verdict: "accepted" | "open" | "rejected",
): Pick<AgentPlanStepResult, "session"> {
  const session = syntheticSession();
  return {
    session: {
      ...session,
      acceptance: session.acceptance && { ...session.acceptance, verdict },
    },
  };
}

function stackRun(
  deliveries: readonly {
    readonly loopId?: string;
    readonly iteration?: number;
  }[],
): AgentPlanStackRun {
  return {
    id: "stack",
    name: "Stack",
    total: 3,
    deliveries: deliveries.map((delivery, index) => ({
      entryId: `entry-${index + 1}`,
      position: index + 1,
      loopId: delivery.loopId ?? null,
      iteration: delivery.iteration ?? null,
      at: "2026-11-10T10:00:00.000Z",
    })),
    emptyTriggers: 0,
    last: "entry",
  };
}

function loopRun(
  id: string,
  overrides: Partial<AgentPlanLoopRun> = {},
): AgentPlanLoopRun {
  return {
    id,
    name: id,
    status: "succeeded",
    count: null,
    sessionPolicy: "fresh",
    condition: null,
    iterations: [],
    sessions: [],
    completion: "count_reached",
    cleanup: "not_needed",
    startedAt: null,
    endedAt: null,
    error: null,
    ...overrides,
  };
}

function iteration(
  number: number,
  nodes: AgentPlanStepResult[],
): AgentPlanLoopRun["iterations"][number] {
  return {
    id: `iteration-${number}`,
    number,
    status: "succeeded",
    startedAt: "2026-11-10T10:00:00.000Z",
    endedAt: null,
    nodes,
    condition: { state: "not_evaluated", reason: "disabled" },
    error: null,
  };
}

function runOf(
  steps: AgentPlanStepResult[],
  overrides: Partial<RunView> = {},
): RunView {
  return {
    status: "running",
    steps,
    stacks: [stackRun([{}])],
    ...overrides,
  };
}

describe("an open report of a succeeded node", () => {
  it("is absent without a result or without a report", () => {
    expect(hasOpenPlanStepReport(undefined)).toBe(false);
    expect(hasOpenPlanStepReport(result("a"))).toBe(false);
  });

  it("is present when the acceptance stays open or was rejected", () => {
    expect(hasOpenPlanStepReport(result("a", withVerdict("open")))).toBe(true);
    expect(hasOpenPlanStepReport(result("a", withVerdict("rejected")))).toBe(
      true,
    );
    expect(hasOpenPlanStepReport(result("a", withVerdict("accepted")))).toBe(
      false,
    );
  });

  it("follows the report of a script that did not pass", () => {
    const report = (
      status: "passed" | "failed" | "partial",
    ): NonNullable<AgentPlanStepResult["report"]> => ({
      status,
      summary: "Checked",
      checkCount: 2,
      failedCount: status === "failed" ? 1 : 0,
      partialCount: status === "partial" ? 1 : 0,
    });

    expect(
      hasOpenPlanStepReport(result("s", { report: report("passed") })),
    ).toBe(false);
    expect(
      hasOpenPlanStepReport(result("s", { report: report("failed") })),
    ).toBe(true);
    expect(
      hasOpenPlanStepReport(result("s", { report: report("partial") })),
    ).toBe(true);
  });

  it("is never present for a node that did not succeed", () => {
    expect(
      hasOpenPlanStepReport(
        result("a", { status: "failed", ...withVerdict("open") }),
      ),
    ).toBe(false);
  });
});

describe("the participants of a stack", () => {
  it("are the nodes its trigger starts, in order and once", () => {
    const plan = planOf(
      [STACK, agent("a"), agent("b")],
      [trigger("a"), trigger("b"), trigger("a")],
    );

    expect(planStackParticipants(plan, "stack")).toEqual(["a", "b"]);
  });

  it("ignore the flow of another node and any other port of the stack", () => {
    const plan = planOf(
      [STACK, agent("a"), agent("b")],
      [
        { from: "a", to: "b", fromPort: "flow-out", toPort: "flow-in" },
        { from: "stack", to: "b", fromPort: "content-out", toPort: "in" },
      ],
    );

    expect(planStackParticipants(plan, "stack")).toEqual([]);
  });

  it("include the agents of a group the trigger starts", () => {
    const outer = groupOf("group", [agent("g1"), agent("g2")]);
    const inLoop = groupOf("inner", [agent("i1")]);
    const plan = planOf(
      [STACK, outer, loopOf("loop", [inLoop])],
      [trigger("group"), trigger("inner")],
    );

    expect(planStackParticipants(plan, "stack")).toEqual(["g1", "g2", "i1"]);
  });

  it("include the nodes that read the content output, loop members too", () => {
    const content = CONTENT;
    const count: AgentPlanBinding = {
      kind: "stack",
      stackId: "stack",
      output: "count",
    };
    const other: AgentPlanBinding = {
      kind: "stack",
      stackId: "elsewhere",
      output: "content",
    };
    const nodes: AgentPlanNode[] = [
      STACK,
      agent("reader", { text: content }),
      script("counter", { text: count }),
      agent("stranger", { text: other }),
      loopOf("loop", [agent("member", { text: content })], [], {
        bindings: { runs: content },
      }),
    ];

    expect(planStackParticipants(planOf(nodes), "stack")).toEqual([
      "reader",
      "member",
    ]);
  });
});

describe("the outcome of a stack in the outer graph", () => {
  const plan = planOf(
    [STACK, agent("a"), agent("b")],
    [trigger("a"), trigger("b")],
  );

  it("is none without a run, a record or a delivery", () => {
    expect(planStackOutcome(plan, null, "stack")).toBe("none");
    expect(
      planStackOutcome(plan, runOf([], { stacks: undefined }), "stack"),
    ).toBe("none");
    expect(
      planStackOutcome(plan, runOf([], { stacks: [stackRun([])] }), "stack"),
    ).toBe("none");
    expect(
      planStackOutcome(
        plan,
        runOf([result("a")], { stacks: [{ ...stackRun([{}]), id: "other" }] }),
        "stack",
      ),
    ).toBe("none");
  });

  it("is none for a stack that joins a loop and the outer graph", () => {
    const mixed = planOf(
      [STACK, agent("a"), loopOf("loop", [agent("m")])],
      [trigger("a"), trigger("m")],
    );

    expect(planStackOutcome(mixed, runOf([result("a")]), "stack")).toBe("none");
  });

  it("succeeds once every participant processed its entry", () => {
    expect(
      planStackOutcome(plan, runOf([result("a"), result("b")]), "stack"),
    ).toBe("succeeded");
  });

  it("processes while a participant has no result or is still working", () => {
    expect(planStackOutcome(plan, runOf([result("a")]), "stack")).toBe(
      "processing",
    );
    expect(
      planStackOutcome(
        plan,
        runOf([result("a"), result("b", { status: "running" })]),
        "stack",
      ),
    ).toBe("processing");
    expect(
      planStackOutcome(
        plan,
        runOf([result("a"), result("b", { status: "waiting" })]),
        "stack",
      ),
    ).toBe("processing");
  });
});

describe("the outcome of a stack once the run or a participant ended", () => {
  const plan = planOf(
    [STACK, agent("a"), agent("b")],
    [trigger("a"), trigger("b")],
  );

  it("fails when work is still pending although the run is over", () => {
    for (const status of [
      "succeeded",
      "failed",
      "cancelled",
      "work_done_closeout_open",
    ] as const)
      expect(
        planStackOutcome(plan, runOf([result("a")], { status }), "stack"),
      ).toBe("failed");
    expect(
      planStackOutcome(
        plan,
        runOf([result("a")], { status: "paused" }),
        "stack",
      ),
    ).toBe("processing");
  });

  it("fails as soon as a participant failed, was cancelled or is blocked", () => {
    for (const overrides of [
      { status: "failed" },
      { status: "cancelled" },
      { status: "succeeded", isBlocked: true },
    ] as const)
      expect(
        planStackOutcome(
          plan,
          runOf([result("a", overrides), result("b")]),
          "stack",
        ),
      ).toBe("failed");
  });

  it("stays open while a succeeded participant left its report open", () => {
    expect(
      planStackOutcome(
        plan,
        runOf([result("a"), result("b", withVerdict("open"))]),
        "stack",
      ),
    ).toBe("open");
  });

  it("is none when every participant skipped the entry", () => {
    expect(
      planStackOutcome(
        plan,
        runOf([
          result("a", { status: "skipped" }),
          result("b", { status: "skipped" }),
        ]),
        "stack",
      ),
    ).toBe("none");
  });

  it("is none when no participant exists, also for readers inside a loop", () => {
    const content = CONTENT;
    const reading = planOf([
      STACK,
      loopOf("loop", [agent("member", { text: content })]),
    ]);

    expect(planStackOutcome(reading, runOf([result("member")]), "stack")).toBe(
      "none",
    );
  });

  it("waits for a loop participant until the loop was left regularly", () => {
    const withLoop = planOf(
      [STACK, loopOf("loop", [agent("m")])],
      [trigger("loop")],
    );
    const left = loopRun("loop");

    expect(
      planStackOutcome(
        withLoop,
        runOf([result("loop")], { loops: [left] }),
        "stack",
      ),
    ).toBe("succeeded");
    expect(
      planStackOutcome(
        withLoop,
        runOf([result("loop")], {
          loops: [loopRun("loop", { cleanup: "pending" })],
        }),
        "stack",
      ),
    ).toBe("processing");
  });
});

const LOOP_PLAN = planOf(
  [STACK, loopOf("loop", [agent("a"), agent("b")])],
  [trigger("a")],
);

function loopedRun(
  record: AgentPlanLoopRun | undefined,
  stacks: AgentPlanStackRun[],
  status: RunView["status"] = "running",
): RunView {
  return {
    status,
    steps: [],
    loops: record ? [record] : undefined,
    stacks,
  };
}

const delivered = stackRun([
  { loopId: "loop", iteration: 1 },
  { loopId: "loop", iteration: 2 },
]);

describe("the outcome of a stack a loop triggers", () => {
  const plan = LOOP_PLAN;

  it("succeeds when the loop was left and each iteration processed its entry", () => {
    const record = loopRun("loop", {
      iterations: [
        iteration(1, [result("a")]),
        iteration(2, [result("a"), result("b")]),
      ],
    });

    expect(
      planStackOutcome(plan, loopedRun(record, [delivered]), "stack"),
    ).toBe("succeeded");
  });

  it("only counts the participants that belong to the loop and the iteration delivered", () => {
    const record = loopRun("loop", {
      iterations: [
        iteration(1, [result("a")]),
        iteration(2, [result("a", { status: "failed" })]),
        iteration(3, [result("a", { status: "failed" })]),
      ],
    });
    const onlyFirst = stackRun([{ loopId: "loop", iteration: 1 }]);
    const foreign = stackRun([
      { loopId: "loop", iteration: 1 },
      { loopId: "another", iteration: 3 },
    ]);

    expect(
      planStackOutcome(plan, loopedRun(record, [onlyFirst]), "stack"),
    ).toBe("succeeded");
    expect(planStackOutcome(plan, loopedRun(record, [foreign]), "stack")).toBe(
      "succeeded",
    );
    expect(
      planStackOutcome(plan, loopedRun(record, [delivered]), "stack"),
    ).toBe("failed");
  });

  it("treats a delivery without a recorded iteration as pending", () => {
    const record = loopRun("loop", {
      iterations: [iteration(1, [result("a")])],
    });

    expect(
      planStackOutcome(plan, loopedRun(record, [delivered]), "stack"),
    ).toBe("processing");
    expect(
      planStackOutcome(plan, loopedRun(record, [delivered], "failed"), "stack"),
    ).toBe("failed");
  });
});

describe("the outcome of a stack whose loop did not end regularly", () => {
  const plan = LOOP_PLAN;

  it("processes while the loop is not recorded, waiting, running, paused or cleaning up", () => {
    const iterations = [
      iteration(1, [result("a")]),
      iteration(2, [result("a")]),
    ];

    expect(
      planStackOutcome(plan, loopedRun(undefined, [delivered]), "stack"),
    ).toBe("processing");
    for (const overrides of [
      { status: "waiting" },
      { status: "running" },
      { status: "paused" },
      { status: "succeeded", cleanup: "pending" },
    ] as const)
      expect(
        planStackOutcome(
          plan,
          loopedRun(loopRun("loop", { iterations, ...overrides }), [delivered]),
          "stack",
        ),
      ).toBe("processing");
  });

  it("fails when the loop ended without a regular exit", () => {
    const iterations = [
      iteration(1, [result("a")]),
      iteration(2, [result("a")]),
    ];

    for (const overrides of [
      { status: "failed" },
      { status: "cancelled" },
      { status: "succeeded", cleanup: "failed" },
      { status: "succeeded", completion: null },
    ] as const)
      expect(
        planStackOutcome(
          plan,
          loopedRun(loopRun("loop", { iterations, ...overrides }), [delivered]),
          "stack",
        ),
      ).toBe("failed");
  });

  it("fails an unrecorded loop once the run is over", () => {
    expect(
      planStackOutcome(
        plan,
        loopedRun(undefined, [delivered], "cancelled"),
        "stack",
      ),
    ).toBe("failed");
  });

  it("stays open when a participant of an iteration left its report open", () => {
    const record = loopRun("loop", {
      iterations: [
        iteration(1, [result("a", withVerdict("rejected"))]),
        iteration(2, [result("a")]),
      ],
    });

    expect(
      planStackOutcome(plan, loopedRun(record, [delivered]), "stack"),
    ).toBe("open");
  });

  it("is none when the iterations skipped every entry", () => {
    const record = loopRun("loop", {
      iterations: [
        iteration(1, [result("a", { status: "skipped" })]),
        iteration(2, [result("a", { status: "skipped" })]),
      ],
    });

    expect(
      planStackOutcome(plan, loopedRun(record, [delivered]), "stack"),
    ).toBe("none");
  });
});
