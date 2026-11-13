import { expect, it, vi } from "vitest";

import { planControl } from "@/backend/service/agents/AgentPlanControl";
import {
  planResume,
  resumeOption,
} from "@/backend/service/agents/recovery/AgentPlanRecoveryPlanning";
import { endTaggedProcesses } from "@/backend/agents/cli/CliProcessScan";

import { failedStackWorld, recoveryFor } from "./page356-recovery-fixture";
import { finishedRun } from "./page175-stack-fixture";

vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  readScopeSince: vi.fn(async () => ({ earliestStart: 0 })),
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
  findTaggedProcesses: vi.fn(async () => []),
}));

it("continues only QA and successors, retaining prepare output and both completed stack iterations", async () => {
  const world = await failedStackWorld("qa");
  const started = await world.engine.start("owner", world.snapshot);
  const failed = await finishedRun(world, started.id);
  expect(failed.status).toBe("failed");
  const recovery = recoveryFor(world);
  const view = await recovery.service.view("owner", failed.id);
  expect(view.resume.available).toBe(true);
  expect(view.blockers).not.toContain("branching_unsupported");
  expect(view.blockers).not.toContain("workflow_unavailable");
  const result = await recovery.service.resumeEnded(
    "owner",
    failed.id,
    world.plan.revision,
  );
  const run = await finishedRun(world, result.runId ?? "missing");
  expect(run.status).toBe("succeeded");
  expect(world.runtime.calls.map((call) => call.nodeId)).toEqual([
    "work",
    "work",
    "qa",
    "qa",
  ]);
  expect(world.scriptCalls.map((call) => call.id)).toEqual([
    "prepare",
    "after",
  ]);
  expect(run.steps.find((step) => step.id === "after")?.output).toBe(
    "after: saved preparation",
  );
  expect(run.loops).toEqual(failed.loops);
  expect(run.stacks).toEqual(failed.stacks);
  expect(run.origin).toMatchObject({
    kind: "resume",
    runId: failed.id,
    reusedStepIds: expect.arrayContaining(["start", "prepare", "loop"]),
  });
  expect(world.read(failed.id)).toEqual(failed);
});

it("retries iteration 2 with its existing stack entry and the new saved instruction, then proceeds to QA", async () => {
  const world = await failedStackWorld("iteration");
  const started = await world.engine.start("owner", world.snapshot);
  const failed = await finishedRun(world, started.id);
  expect(failed.status).toBe("failed");
  expect(
    failed.loops?.[0]?.iterations.map((iteration) => iteration.status),
  ).toEqual(["succeeded", "failed"]);
  const steps = world.snapshot.steps.map((step) =>
    step.step.id === "work"
      ? {
          ...step,
          step: {
            ...step.step,
            instruction: `${step.step.instruction} Fixed instruction.`,
          },
        }
      : step,
  );
  const proposed = {
    ...world.snapshot,
    steps,
    plan: {
      ...world.plan,
      revision: world.plan.revision + 1,
      nodes: world.plan.nodes.map((node) =>
        node.type === "loop"
          ? {
              ...node,
              steps: node.steps.map((member) =>
                member.id === "work" && member.type === "agent"
                  ? {
                      ...member,
                      instruction: `${member.instruction} Fixed instruction.`,
                    }
                  : member,
              ),
            }
          : node,
      ),
    },
  };
  const recovery = recoveryFor(world, proposed);
  const result = await recovery.service.resumeEnded(
    "owner",
    failed.id,
    proposed.plan.revision,
  );
  const run = await finishedRun(world, result.runId ?? "missing");
  expect(run.status).toBe("succeeded");
  expect(world.runtime.calls.map((call) => call.nodeId)).toEqual([
    "work",
    "work",
    "work",
    "qa",
  ]);
  const retry = world.runtime.calls[2]?.prompt ?? "";
  expect(retry).toContain("Fixed instruction.");
  expect(retry).toContain("SYN-2");
  expect(retry).not.toContain("SYN-1");
  expect(retry).toContain("Needs a fix");
  expect(run.loops?.[0]?.iterations[0]).toEqual(
    failed.loops?.[0]?.iterations[0],
  );
  expect(run.stacks?.[0]?.deliveries).toHaveLength(2);
  expect(world.scriptCalls.map((call) => call.id)).toEqual([
    "prepare",
    "after",
  ]);
});

it("continues an interrupted run with unconfirmed process end and releases its reservations", async () => {
  const world = await failedStackWorld("unconfirmed");
  const started = await world.engine.start("owner", world.snapshot);
  const failed = await finishedRun(world, started.id);
  vi.mocked(endTaggedProcesses).mockRejectedValueOnce(
    new Error("Process end unknown"),
  );
  const recovery = recoveryFor(world);
  const result = await recovery.service.resumeEnded(
    "owner",
    failed.id,
    world.plan.revision,
  );
  expect((await finishedRun(world, result.runId ?? "missing")).status).toBe(
    "succeeded",
  );
  expect(recovery.releaseForResume).toHaveBeenCalledWith(failed.id);
  expect([...world.database.stored().locks.values()]).not.toContain(failed.id);
});

it("refuses resume after Stop even with completed checkpoints and still allows Start", async () => {
  const world = await failedStackWorld("qa");
  const started = await world.engine.start("owner", world.snapshot);
  const failed = await finishedRun(world, started.id);
  const stopped = {
    ...failed,
    stopRequested: true,
    status: "cancelled" as const,
  };
  const plan = {
    ...world.plan,
    canEdit: true,
    projectName: "Synthetic",
    github: null,
  };
  const control = planControl(plan, stopped, {
    userId: "owner",
    hasReservation: true,
  });
  expect(control).toMatchObject({
    canResume: false,
    canPlay: true,
    resumeKind: "stopped",
  });
  const facts = {
    run: stopped,
    plan,
    latest: stopped,
    isEngineActive: false,
    isReserved: true,
    checkpoints: [],
    executions: [],
    agentStepIds: ["qa", "work"],
    groupIds: [],
  };
  expect(resumeOption(facts, planResume(facts))).toEqual({
    available: false,
    reason: "cancelled_by_user",
  });
  await recoveryFor(world).service.stopRun("owner", stopped.id);
  await expect(
    recoveryFor(world).service.resumeEnded("owner", stopped.id, plan.revision),
  ).rejects.toMatchObject({ code: "action_unavailable" });
});

it("offers continuation of legacy interrupted work even without checkpoints or a reliable engine-ownership answer", async () => {
  const world = await failedStackWorld("qa");
  const started = await world.engine.start("owner", world.snapshot);
  const failed = await finishedRun(world, started.id);
  const interrupted = {
    ...failed,
    recovery: undefined,
    steps: failed.steps.map((step) =>
      step.id === "qa" ? { ...step, status: "running" as const } : step,
    ),
  };
  const facts = {
    run: interrupted,
    plan: {
      ...world.plan,
      canEdit: true,
      projectName: "Synthetic",
      github: null,
    },
    latest: interrupted,
    isEngineActive: true,
    isReserved: true,
    checkpoints: [],
    executions: [],
    agentStepIds: ["qa", "work"],
    groupIds: [],
    hasBranching: true,
  };
  const planned = planResume(facts);
  expect(resumeOption(facts, planned)).toEqual({
    available: true,
    reason: null,
  });
  expect(planned.reused.map((step) => step.id)).toEqual(
    expect.arrayContaining(["prepare", "loop"]),
  );
  expect(planned.retriedStepIds).toContain("qa");
});
