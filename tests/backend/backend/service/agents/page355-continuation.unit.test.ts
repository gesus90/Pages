import { expect, it } from "vitest";

import { prepareRecoveredPlan } from "@/backend/service/agents/AgentPlanContinuation";
import { resumedLoopRuns } from "@/backend/service/agents/recovery/AgentPlanRecoveryPlanning";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";

import {
  finishedRun,
  flow,
  stackEngine,
  stackReport,
  stackRuntime,
} from "./page175-stack-fixture";

it("continues the failed member of a stack-counted loop after correction without replaying completed work", async () => {
  const runtime = stackRuntime({
    before: [stackReport()],
    work: [stackReport()],
    after: [stackReport()],
  });
  const world = await stackEngine(runtime.execution, {
    nodes: ({ plain }) => [
      { id: "start", type: "start", x: 0, y: 0 },
      { id: "end", type: "end", x: 900, y: 0 },
      plain("before"),
      {
        id: "stack",
        type: "stack",
        name: "Inputs",
        entries: [
          {
            id: "entry",
            type: "parameter",
            name: "input",
            format: "string",
            value: { type: "text", text: "input" },
          },
        ],
        x: 0,
        y: 0,
      },
      {
        ...emptyPlanLoop("loop", "Loop", { x: 200, y: 0 }),
        runsSource: "parameter",
        bindings: {
          runs: { kind: "stack", stackId: "stack", output: "count" },
        },
        steps: [
          { ...plain("work"), agentId: "missing", configuration: undefined },
        ],
      },
      plain("after"),
    ],
    edges: [
      flow("start", "before"),
      flow("before", "loop"),
      flow("loop", "after"),
      flow("after", "end"),
    ],
  });
  const initial = await world.engine.start("owner", world.snapshot);
  const failed = await finishedRun(world, initial.id);
  expect(failed.status).toBe("failed");
  expect(failed.loops?.[0]?.iterations[0]?.nodes[0]).toMatchObject({
    id: "work",
    status: "failed",
    error: "configuration_invalid",
  });
  expect(runtime.calls.map((call) => call.nodeId)).toEqual(["before"]);
  const template = world.snapshot.steps.find(
    (step) => step.step.id === "after",
  );
  if (!template) throw new Error("Missing correction template");
  const corrected = await world.preparation.prepare("owner", {
    ...world.plan,
    revision: world.plan.revision + 1,
    nodes: world.plan.nodes.map((node) =>
      node.type === "loop"
        ? {
            ...node,
            steps: [
              {
                ...template.step,
                id: "work",
                instruction: "Instruction work.",
              },
            ],
          }
        : node,
    ),
  });
  const reused = failed.steps.filter((step) => step.status === "succeeded");
  const reusedIds = reused.map((step) => step.id);
  const adopted = prepareRecoveredPlan(
    {
      ...failed,
      status: "paused",
      pauseBoundary: {
        pausedAt: failed.startedAt,
        completedStepIds: reusedIds,
        frontierStepIds: ["loop"],
        pendingStepIds: ["loop", "after", "end"],
      },
    },
    world.snapshot,
    corrected,
  );
  const loops = resumedLoopRuns(failed.loops ?? [], reusedIds);
  world.savePlan(adopted);
  const resumed = await world.engine.startRecovered(
    "owner",
    adopted,
    {
      origin: {
        kind: "resume",
        runId: failed.id,
        mode: "new_session",
        checkpointVersion: null,
        reusedStepIds: reusedIds,
        retriedStepIds: ["loop"],
        reviewedStepIds: ["loop"],
        requestedAt: failed.startedAt,
      },
      reused,
      loops: loops.loops,
    },
    async () => {},
  );
  const result = await finishedRun(world, resumed.id);
  expect(result.status).toBe("succeeded");
  expect(result.loops?.[0]?.iterations).toHaveLength(1);
  expect(runtime.calls.map((call) => call.nodeId)).toEqual([
    "before",
    "work",
    "after",
  ]);
});
