import { expect, it, vi } from "vitest";

import { readPlanStepResult } from "@/backend/agents/AgentPlanStepResultInput";
import {
  runDetail,
  stepReport,
} from "@/backend/service/agents/AgentPlanOperationViews";
import { updateBlocked } from "@/backend/service/agents/AgentPlanRunState";
import { AgentPlanLoopIterationRunner } from "@/backend/service/agents/loop/AgentPlanLoopIterationRunner";
import {
  beginIteration,
  initialLoopRun,
  patchIterationNode,
} from "@/backend/service/agents/loop/AgentPlanLoopRecord";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";

import { recoveryFixture } from "./page84-recovery-fixture";

import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";
import type { LoopHost } from "@/backend/service/agents/loop/AgentPlanLoopHost";

it("retains the failed source of a blocked successor in persisted and MCP views", async () => {
  const fixture = await recoveryFixture();
  const active: ActivePlanRun = {
    groupCloseout: "open",
    hasPersistenceFailure: false,
    view: { ...fixture.failed, status: "running" },
    snapshot: fixture.snapshot,
    dispatched: new Set(),
    controllers: new Map(),
    executions: new Set(),
  };

  updateBlocked(active);

  const source = active.view.steps.find((step) => step.id === "b");
  const successor = active.view.steps.find((step) => step.id === "c");
  if (!successor) throw new Error("Synthetic successor is missing");
  expect(source).toMatchObject({
    status: "failed",
    error: "plan_group_acceptance_failed",
  });
  expect(successor).toMatchObject({
    status: "waiting",
    isBlocked: true,
    error: "plan_dependency_failed",
    blockedByStepId: "b",
  });
  expect(readPlanStepResult(successor)).toMatchObject({ blockedByStepId: "b" });
  expect(
    runDetail(active.view).steps.find((step) => step.stepId === "c"),
  ).toMatchObject({ blockedByStepId: "b" });
  expect(stepReport(active.view, successor)).toMatchObject({
    blockedByStepId: "b",
  });
});

it("links blocked loop members to their actual failed predecessor", async () => {
  const fixture = await recoveryFixture();
  const loop = {
    ...emptyPlanLoop("loop", "Review", { x: 0, y: 0 }),
    steps: [
      ...fixture.snapshot.steps.map((step) => step.step),
      { ...fixture.snapshot.steps[0].step, id: "unrelated" },
    ],
    edges: fixture.snapshot.plan.edges,
  };
  let record = beginIteration(initialLoopRun(loop), loop, new Map());
  record = patchIterationNode(
    record,
    { number: 1, nodeId: "a" },
    {
      status: "failed",
      error: "plan_script_exit",
    },
  );
  const host: LoopHost = {
    signal: new AbortController().signal,
    run: () => fixture.initial,
    snapshot: () => fixture.snapshot,
    canDispatch: () => true,
    isPausing: () => false,
    authorize: async () => undefined,
    current: () => record,
    update: async (loopId, change) => {
      expect(loopId).toBe(loop.id);
      record = change(record);
      return record;
    },
  };
  const execute = vi.fn();
  const runner = new AgentPlanLoopIterationRunner({ run: execute });

  expect(await runner.run({ loop, number: 1, host })).toBe("failed");
  expect(
    record.iterations[0].nodes.find((node) => node.id === "b"),
  ).toMatchObject({ status: "waiting", isBlocked: true, blockedByStepId: "a" });
  expect(
    record.iterations[0].nodes.find((node) => node.id === "c"),
  ).toMatchObject({ status: "waiting", isBlocked: true, blockedByStepId: "a" });
  expect(
    record.iterations[0].nodes.find((node) => node.id === "unrelated")
      ?.blockedByStepId,
  ).toBeUndefined();
  expect(execute).not.toHaveBeenCalled();
});
