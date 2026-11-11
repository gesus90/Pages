import { expect, it } from "vitest";

import { planEntryResults } from "@/app/components/agents/plans/plan-entry-results-model";

import { loopIteration, loopRun } from "./plan-loop-fixture";
import { agentNode, flowEdge, planOf } from "./plan-group-fixture";
import { runStep } from "./plan-panel-fixture";

import type { PlanEntryResult } from "@/app/components/agents/plans/plan-entry-results-model";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanAssetFile } from "@/definition/AgentPlanAsset";
import type {
  AgentPlanStack,
  AgentPlanStackDelivery,
} from "@/definition/AgentPlanStack";

function file(fileName: string): AgentPlanAssetFile {
  return {
    assetId: `asset-${fileName}`,
    fileName,
    mediaType: "image/png",
    kind: "image",
    size: 10,
    digest: "abc",
  };
}

function stackOf(fileNames: readonly string[]): AgentPlanStack {
  return {
    id: "stack",
    type: "stack",
    name: "Inputs",
    x: 0,
    y: 0,
    entries: fileNames.map((name, index) => ({
      id: `entry-${index + 1}`,
      type: "asset" as const,
      file: file(name),
    })),
  };
}

function plan(stack: AgentPlanStack = stackOf(["a.png", "b.png"])) {
  return planOf(
    [stack, agentNode("worker", "codex")],
    [flowEdge("stack", "worker")],
  );
}

function delivery(
  position: number,
  overrides: Partial<AgentPlanStackDelivery> = {},
): AgentPlanStackDelivery {
  return {
    entryId: `entry-${position}`,
    position,
    loopId: null,
    iteration: null,
    at: "2026-10-15T10:00:00.000Z",
    ...overrides,
  };
}

function runWith(
  overrides: Partial<AgentPlanRun>,
  deliveries: readonly AgentPlanStackDelivery[],
): AgentPlanRun {
  return {
    id: "run",
    planId: "plan",
    planName: "Plan",
    planRevision: 1,
    userId: "owner",
    startedAt: "2026-10-15T10:00:00.000Z",
    status: "running",
    stopRequested: false,
    steps: [],
    stacks: [
      {
        id: "stack",
        name: "Inputs",
        total: 2,
        deliveries,
        emptyTriggers: 0,
        last: "entry",
      },
    ],
    ...overrides,
  };
}

function rows(
  run: AgentPlanRun,
  inputPlan = plan(),
): readonly PlanEntryResult[] {
  return planEntryResults(inputPlan, run)[0]?.rows ?? [];
}

it("lists no overview for a plan without stacks or a stack without files", () => {
  const withoutFiles: AgentPlanStack = {
    ...stackOf([]),
    entries: [{ id: "t", type: "task", taskId: "task-1" }],
  };

  expect(
    planEntryResults(planOf([agentNode("worker", "codex")]), runWith({}, [])),
  ).toEqual([]);
  expect(planEntryResults(plan(withoutFiles), runWith({}, []))).toEqual([]);
});

it("keeps entries that were never handed over waiting, numbered by their stack position", () => {
  const results = planEntryResults(plan(), runWith({ stacks: [] }, []));

  expect(results).toHaveLength(1);
  expect(results[0]?.stackId).toBe("stack");
  expect(results[0]?.name).toBe("Inputs");
  expect(results[0]?.rows.map((row) => [row.position, row.state])).toEqual([
    [1, "waiting"],
    [2, "waiting"],
  ]);
  expect(results[0]?.rows[0]?.resultFile).toBeNull();
  expect(results[0]?.rows[0]?.summary).toBeNull();
});

it("counts positions across non-file entries and shows a delivered entry as running until its node ran", () => {
  const mixed: AgentPlanStack = {
    ...stackOf(["a.png"]),
    entries: [
      { id: "t", type: "task", taskId: "task-1" },
      { id: "entry-1", type: "asset", file: file("a.png") },
    ],
  };
  const result = rows(
    runWith({ steps: [runStep("worker")] }, [
      delivery(2, { entryId: "entry-1" }),
    ]),
    plan(mixed),
  );

  expect(result.map((row) => [row.entryId, row.position, row.state])).toEqual([
    ["entry-1", 2, "running"],
  ]);
});

it("reports the result file that carries the input's name, else the first one, and drops the summary", () => {
  const output = [
    "Fertig.",
    "- Ergebnis: ergebnis-other.png (/agent-plan-assets/res-1)",
    "- Ergebnis: ergebnis-a.png (/agent-plan-assets/res-2)",
  ].join("\n");
  const first = rows(
    runWith(
      {
        steps: [
          runStep("worker", { status: "succeeded", output, activation: 1 }),
        ],
      },
      [delivery(1)],
    ),
  )[0];
  const fallbackOutput = "- Ergebnis: other.png (/agent-plan-assets/res-9)";
  const second = rows(
    runWith(
      {
        steps: [
          runStep("worker", {
            status: "succeeded",
            output: fallbackOutput,
            activation: 1,
          }),
        ],
      },
      [delivery(1)],
    ),
  )[0];

  expect(first?.state).toBe("done");
  expect(first?.resultFile).toEqual({
    assetId: "res-2",
    fileName: "ergebnis-a.png",
  });
  expect(first?.summary).toBeNull();
  expect(second?.resultFile).toEqual({
    assetId: "res-9",
    fileName: "other.png",
  });
});

it("summarizes the first line of an answer without a result file, cut at 200 characters", () => {
  const output = `${"x".repeat(250)}\nsecond line`;
  const row = rows(
    runWith(
      {
        steps: [
          runStep("worker", { status: "succeeded", output, activation: 1 }),
        ],
      },
      [delivery(1)],
    ),
  )[0];

  expect(row?.summary).toBe("x".repeat(200));
  expect(row?.resultFile).toBeNull();
});

it("shows a failed node with its error and no summary", () => {
  const row = rows(
    runWith(
      {
        steps: [
          runStep("worker", {
            status: "failed",
            error: "asset_unreadable",
            activation: 1,
          }),
        ],
      },
      [delivery(1)],
    ),
  )[0];

  expect(row?.state).toBe("failed");
  expect(row?.error).toBe("asset_unreadable");
  expect(row?.summary).toBeNull();
});

it("marks a delivered entry as running while its node runs", () => {
  const row = rows(
    runWith(
      { steps: [runStep("worker", { status: "running", activation: 1 })] },
      [delivery(1)],
    ),
  )[0];

  expect(row?.state).toBe("running");
});

it("matches the n-th handover to the n-th start of the node, taking older starts from its history", () => {
  const history = [
    {
      activation: 1,
      status: "succeeded" as const,
      output: "first answer\nmore",
      error: null,
      startedAt: null,
      endedAt: null,
    },
  ];
  const result = rows(
    runWith(
      {
        steps: [
          runStep("worker", {
            status: "running",
            activation: 2,
            history,
          }),
        ],
      },
      [delivery(1), delivery(2)],
    ),
  );

  expect(result[0]?.state).toBe("done");
  expect(result[0]?.summary).toBe("first answer");
  expect(result[1]?.state).toBe("running");
});

it("ignores a participant that has no record yet", () => {
  const row = rows(runWith({ steps: [] }, [delivery(1)]))[0];

  expect(row?.state).toBe("running");
  expect(row?.error).toBeNull();
});

it("reads the members of the loop iteration that took the entry", () => {
  const stack = plan();
  const base = loopRun([
    {
      ...loopIteration(2, { state: "not_evaluated", reason: "disabled" }),
      nodes: [
        runStep("worker", { status: "succeeded", output: "iteration answer" }),
        runStep("unrelated", { status: "failed", error: "ignored" }),
      ],
    },
  ]);
  const run = runWith({ loops: base.loops }, [
    delivery(1, { loopId: "loop", iteration: 2 }),
  ]);
  const missingLoop = runWith({ loops: base.loops }, [
    delivery(1, { loopId: "other", iteration: 2 }),
  ]);

  expect(rows(run, stack)[0]).toMatchObject({
    state: "done",
    summary: "iteration answer",
    error: null,
  });
  expect(rows(missingLoop, stack)[0]?.state).toBe("running");
});

it("shows a finished node without any answer as done without a summary or file", () => {
  const row = rows(
    runWith(
      {
        steps: [
          runStep("worker", {
            status: "succeeded",
            output: null,
            activation: 1,
          }),
        ],
      },
      [delivery(1)],
    ),
  )[0];

  expect(row).toMatchObject({
    state: "done",
    resultFile: null,
    summary: null,
    error: null,
  });
});
