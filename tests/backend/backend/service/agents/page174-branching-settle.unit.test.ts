import { expect, it, vi } from "vitest";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { closeIdlePlanGroups } from "@/backend/service/agents/AgentPlanGroupCloseout";
import { initialPlanRun } from "@/backend/service/agents/AgentPlanRunStart";
import { settlePlanRun } from "@/backend/service/agents/AgentPlanRunSettle";
import {
  canFinalize,
  patchStep,
} from "@/backend/service/agents/AgentPlanRunState";
import { isStaleStart } from "@/backend/service/agents/branching/AgentPlanBranchSettle";

import {
  branchEdges,
  branchEngine,
  branchReport,
  branchRuntime,
} from "./page174-branching-fixture";

import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";
import type { BranchEngine } from "./page174-branching-fixture";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

const FIX_ANSWER = "Fixed the open problem of round 1.";

function stepOf(
  run: AgentPlanRun | undefined,
  id: string,
): AgentPlanStepResult {
  const step = run?.steps.find((entry) => entry.id === id);
  if (!step) throw new Error(`No step ${id}`);
  return step;
}

/** A run the scheduler holds, put into the exact state a test needs: nothing of it is executed. */
function activeRun(
  world: BranchEngine,
  steps: Readonly<Record<string, Partial<AgentPlanStepResult>>>,
): ActivePlanRun {
  const active: ActivePlanRun = {
    groupCloseout: "open",
    hasPersistenceFailure: false,
    view: initialPlanRun("owner", world.snapshot),
    snapshot: world.snapshot,
    dispatched: new Set(),
    controllers: new Map(),
    executions: new Set(),
  };
  for (const [id, changes] of Object.entries(steps))
    patchStep(active, id, changes);
  return active;
}

/** The state after the checker said false, the decision took false and the fix agent answered. */
function afterFix(): Record<string, Partial<AgentPlanStepResult>> {
  return {
    start: { status: "succeeded", activation: 1 },
    check: {
      status: "succeeded",
      activation: 1,
      passed: false,
      output: "Checked.",
    },
    decision: {
      status: "succeeded",
      activation: 1,
      branch: "false",
      condition: { sourceStepId: "check", sourceActivation: 1, value: false },
    },
    fix: { status: "succeeded", activation: 1, output: "Fixed the title." },
    end: { status: "skipped" },
  };
}

async function finished(
  world: { readonly read: (id: string) => AgentPlanRun },
  id: string,
): Promise<AgentPlanRun> {
  await expect
    .poll(() => world.read(id).status, { timeout: 8000 })
    .toMatch(/^(succeeded|failed|cancelled)$/u);
  return world.read(id);
}

it("does not call a run idle while a result is still on its way back: the session of the checker stays open", async () => {
  const world = await branchEngine(branchRuntime({}).execution);
  // The fix agent ended after the last settle of the scheduler: its result is not queued yet.
  const active = activeRun(world, afterFix());
  const update = vi
    .fn<AgentPlanRunRepository["update"]>()
    .mockResolvedValue(undefined);
  const closeGroups = vi.fn<(runId: string) => Promise<void>>();

  await closeIdlePlanGroups([active], {
    writes: new SerialQueue(),
    runs: { update },
    steps: { closeGroups },
  });

  expect(closeGroups).not.toHaveBeenCalled();
  expect(active.groupCloseout).toBe("open");
  expect(update).toHaveBeenCalledTimes(1);
  // The checker waits for its second start with the news of the fix.
  expect(stepOf(active.view, "check")).toMatchObject({
    status: "waiting",
    trigger: { kind: "event", sources: [{ stepId: "fix", activation: 1 }] },
  });
});

it("still closes the sessions of a run that really ended", async () => {
  const world = await branchEngine(branchRuntime({}).execution);
  const active = activeRun(world, {
    start: { status: "succeeded", activation: 1 },
    check: { status: "succeeded", activation: 1, passed: true, output: "OK." },
    decision: {
      status: "succeeded",
      activation: 1,
      branch: "true",
      condition: { sourceStepId: "check", sourceActivation: 1, value: true },
    },
    fix: { status: "skipped" },
    end: { status: "succeeded", activation: 1 },
  });
  const update = vi
    .fn<AgentPlanRunRepository["update"]>()
    .mockResolvedValue(undefined);
  const closeGroups = vi
    .fn<(runId: string) => Promise<void>>()
    .mockResolvedValue(undefined);

  await closeIdlePlanGroups([active], {
    writes: new SerialQueue(),
    runs: { update },
    steps: { closeGroups },
  });

  expect(closeGroups).toHaveBeenCalledWith(active.view.id);
  expect(active.groupCloseout).toBe("closed");
  expect(update).not.toHaveBeenCalled();
});

it("keeps the fix of a pausing run: it pauses with the checker as its frontier instead of ending", async () => {
  const world = await branchEngine(branchRuntime({}).execution);
  const active = activeRun(world, afterFix());
  active.view = { ...active.view, status: "pausing" };

  expect(settlePlanRun(active)).toBe(true);

  expect(active.view.status).toBe("paused");
  expect(active.view.pauseBoundary?.frontierStepIds).toEqual(["check"]);
  expect(active.view.pauseBoundary?.pendingStepIds).toEqual(["check"]);
  // The checker did not start while the run was not going on.
  expect(stepOf(active.view, "check").status).toBe("succeeded");
  expect(canFinalize(active)).toBe(false);
});

it("pauses during the fix, keeps the session and continues in it on resume", async () => {
  const runtime = branchRuntime(
    {
      check: [branchReport(false), branchReport(true)],
      fix: [`${FIX_ANSWER}\n${branchReport(true)}`],
    },
    ["fix"],
  );
  const world = await branchEngine(runtime.execution);
  const started = await world.engine.start("owner", world.snapshot);
  await expect
    .poll(() => runtime.calls.some((call) => call.stepId === "fix"))
    .toBe(true);
  await world.engine.pause(started.id);
  runtime.release("fix");
  await expect.poll(() => world.read(started.id).status).toBe("paused");

  const paused = world.read(started.id);
  expect(paused.pauseBoundary?.frontierStepIds).toEqual(["fix"]);
  expect(stepOf(paused, "fix").status).toBe("running");
  expect(stepOf(paused, "check").activation).toBe(1);
  expect(runtime.calls.map((call) => `${call.kind}:${call.stepId}`)).toEqual([
    "open:check",
    "open:fix",
  ]);
  // The checker keeps its session for the news; the Fix turn stays suspended.
  expect(runtime.closed).not.toContain("check");

  // An unsaved revision cannot be adopted: continuation requires the current durable draft.
  await expect(
    world.engine.resume(started.id, {
      ...world.snapshot,
      plan: {
        ...world.snapshot.plan,
        revision: world.snapshot.plan.revision + 1,
      },
    }),
  ).rejects.toMatchObject({
    code: new AgentError("plan_conflict").code,
  });
  expect(world.read(started.id).status).toBe("paused");

  await world.engine.resume(started.id, world.snapshot);
  const run = await finished(world, started.id);
  expect(run.status).toBe("succeeded");
  expect(runtime.calls.map((call) => `${call.kind}:${call.stepId}`)).toEqual([
    "open:check",
    "open:fix",
    "next:check",
  ]);
  expect(runtime.calls[2]?.prompt).toContain(FIX_ANSWER);
  expect(runtime.calls[2]?.prompt).not.toContain("Main instruction (AGENT.md)");
  expect(stepOf(run, "check").session?.event).toMatchObject({
    role: "continued",
    activation: 2,
  });
  expect(runtime.closed).toContain("check");
});

it("keeps the failure of a fix agent that ran beside one that succeeded: the run fails, no new round erases it", async () => {
  const runtime = branchRuntime({
    check: [branchReport(false), branchReport(true)],
    fixa: [`${FIX_ANSWER}\n${branchReport(true)}`],
    fixb: Array.from(
      { length: 3 },
      () => "This answer has no closing report at all.",
    ),
  });
  const world = await branchEngine(runtime.execution, {
    nodes: (agent) => [
      { id: "start", type: "start", x: 0, y: 0 },
      agent("check", 300),
      { id: "decision", type: "decision", x: 600, y: 0 },
      agent("fixa", 900),
      agent("fixb", 900),
      { id: "end", type: "end", x: 1200, y: 0 },
    ],
    edges: [
      ...branchEdges().filter(
        (edge) => edge.from !== "fix" && edge.to !== "fix",
      ),
      {
        from: "decision",
        to: "fixa",
        fromPort: "false-out",
        toPort: "flow-in",
      },
      {
        from: "decision",
        to: "fixb",
        fromPort: "false-out",
        toPort: "flow-in",
      },
      { from: "fixa", to: "check", fromPort: "value-out", toPort: "event-in" },
      { from: "fixb", to: "check", fromPort: "value-out", toPort: "event-in" },
    ],
  });
  const started = await world.engine.start("owner", world.snapshot);
  const run = await finished(world, started.id);

  expect(run.status).toBe("failed");
  expect(stepOf(run, "fixb")).toMatchObject({
    status: "failed",
    error: "plan_acceptance_failed",
  });
  // The checker was not started again behind the back of the failure.
  expect(runtime.calls.filter((call) => call.stepId === "check")).toHaveLength(
    1,
  );
  expect(stepOf(run, "check").activation).toBe(1);
});

it("lets a result go that waits for a target which can never start", async () => {
  const world = await branchEngine(branchRuntime({}).execution);
  const active = activeRun(world, {
    ...afterFix(),
    check: { ...afterFix().check, status: "waiting", isBlocked: true },
  });
  active.view = { ...active.view, status: "running" };

  settlePlanRun(active);

  expect(active.branching?.pending).toEqual([]);
  expect(stepOf(active.view, "check").status).toBe("waiting");
});

it("counts every node of the round against the limit of starts, not only the one that returns", async () => {
  const world = await branchEngine(branchRuntime({}).execution);
  const active = activeRun(world, {
    ...afterFix(),
    check: { ...afterFix().check, activation: 2 },
    fix: { ...afterFix().fix, activation: 25 },
  });

  settlePlanRun(active);

  expect(stepOf(active.view, "check")).toMatchObject({
    status: "failed",
    error: "plan_activation_limit",
  });
});

it("forgets results of nodes whose start ended with the round", async () => {
  const world = await branchEngine(branchRuntime({}).execution, {
    nodes: (agent) => [
      { id: "start", type: "start", x: 0, y: 0 },
      agent("outer", 300),
      { id: "outerDecision", type: "decision", x: 600, y: 0 },
      agent("outerFix", 900),
      agent("inner", 900),
      { id: "innerDecision", type: "decision", x: 1200, y: 0 },
      agent("innerFix", 1500),
      { id: "end", type: "end", x: 1800, y: 0 },
    ],
    edges: [
      { from: "start", to: "outer", fromPort: "flow-out", toPort: "flow-in" },
      {
        from: "outer",
        to: "outerDecision",
        fromPort: "passed-out",
        toPort: "condition-in",
      },
      {
        from: "outerDecision",
        to: "inner",
        fromPort: "true-out",
        toPort: "flow-in",
      },
      {
        from: "outerDecision",
        to: "outerFix",
        fromPort: "false-out",
        toPort: "flow-in",
      },
      {
        from: "outerFix",
        to: "outer",
        fromPort: "value-out",
        toPort: "event-in",
      },
      {
        from: "inner",
        to: "innerDecision",
        fromPort: "passed-out",
        toPort: "condition-in",
      },
      {
        from: "innerDecision",
        to: "end",
        fromPort: "true-out",
        toPort: "flow-in",
      },
      {
        from: "innerDecision",
        to: "innerFix",
        fromPort: "false-out",
        toPort: "flow-in",
      },
      {
        from: "innerFix",
        to: "inner",
        fromPort: "value-out",
        toPort: "event-in",
      },
    ],
  });
  // Both cycles have a result on its way back; the outer one restarts first and takes the inner round with it.
  const active = activeRun(world, {
    start: { status: "succeeded", activation: 1 },
    outer: { status: "succeeded", activation: 1, passed: false, output: "x" },
    outerDecision: {
      status: "succeeded",
      activation: 1,
      branch: "false",
      condition: {
        sourceStepId: "outer",
        sourceActivation: 1,
        value: false,
      },
    },
    outerFix: { status: "succeeded", activation: 1, output: "Outer news." },
    inner: { status: "succeeded", activation: 1, passed: false, output: "y" },
    innerDecision: {
      status: "succeeded",
      activation: 1,
      branch: "false",
      condition: { sourceStepId: "inner", sourceActivation: 1, value: false },
    },
    innerFix: { status: "succeeded", activation: 1, output: "Inner news." },
    end: { status: "skipped" },
  });

  settlePlanRun(active);

  expect(stepOf(active.view, "outer").status).toBe("waiting");
  // The inner fix forgot its answer with the round, so nothing of it returns to the inner checker.
  expect(stepOf(active.view, "innerFix").status).toBe("waiting");
  expect(active.branching?.pending).toEqual([]);
});

it("evaluates anew on every activation: a decision that runs again reads the current start of the agent", async () => {
  const world = await branchEngine(branchRuntime({}).execution);
  const active = activeRun(world, {
    start: { status: "succeeded", activation: 1 },
    check: { status: "succeeded", activation: 1, passed: false, output: "No." },
  });

  settlePlanRun(active);
  expect(stepOf(active.view, "decision")).toMatchObject({
    status: "succeeded",
    branch: "false",
    activation: 1,
  });

  // The decision is made to wait again and evaluates anew (PAGE-286).
  patchStep(active, "decision", { status: "waiting", branch: undefined });
  settlePlanRun(active);

  expect(stepOf(active.view, "decision")).toMatchObject({
    status: "succeeded",
    branch: "false",
    activation: 2,
  });
});

it("evaluates the next start of the agent as a new value and may take the other branch", async () => {
  const world = await branchEngine(branchRuntime({}).execution);
  const active = activeRun(world, {
    start: { status: "succeeded", activation: 1 },
    check: { status: "succeeded", activation: 1, passed: false, output: "No." },
  });
  settlePlanRun(active);
  expect(stepOf(active.view, "decision").branch).toBe("false");

  // The agent ran again and passed: a fresh start of the same agent, a fresh evaluation.
  patchStep(active, "check", { activation: 2, passed: true, output: "Yes." });
  patchStep(active, "decision", { status: "waiting", branch: undefined });
  settlePlanRun(active);

  expect(stepOf(active.view, "decision")).toMatchObject({
    status: "succeeded",
    branch: "true",
    activation: 2,
    condition: { sourceStepId: "check", sourceActivation: 2, value: true },
  });
});

it("ignores a result that arrives after the node began another start, and keeps that of the newer one", async () => {
  const world = await branchEngine(branchRuntime({}).execution);
  const active = activeRun(world, {
    check: { status: "running", activation: 2 },
  });

  expect(isStaleStart(active, "check", 1)).toBe(true);
  expect(isStaleStart(active, "check", 2)).toBe(false);
  // A plan without counted starts has nothing to compare.
  expect(isStaleStart(active, "check", undefined)).toBe(false);
});
