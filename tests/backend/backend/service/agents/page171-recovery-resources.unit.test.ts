import { expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { releasePlanRun } from "@/backend/service/agents/AgentPlanRecoveryOperation";
import { endTaggedProcesses } from "@/backend/agents/cli/CliProcessScan";
import { planCleanupResources } from "@/backend/service/agents/recovery/AgentPlanCleanupResources";
import {
  canReadPlanContinuation,
  planRecoveryEntry,
} from "@/backend/service/agents/AgentPlanRecoveryViews";
import {
  beginIteration,
  initialLoopRun,
  patchIterationNode,
} from "@/backend/service/agents/loop/AgentPlanLoopRecord";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";

import { patchRecoveryStep, recoveryFixture } from "./page84-recovery-fixture";
import { recoveryWorld } from "./page171-recovery-world";
import { remoteCompletion } from "./page171-remote-acceptance-fixture";

import type * as CliProcessScan from "@/backend/agents/cli/CliProcessScan";

vi.mock("@/backend/agents/cli/CliProcessScan", async (importOriginal) => {
  const original = await importOriginal<typeof CliProcessScan>();
  return {
    ...original,
    readScopeSince: vi.fn(async () => ({ earliestStart: 0 })),
    findTaggedProcesses: vi.fn(async () => []),
    endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
  };
});

it.each(["pending", "failed"] as const)(
  "names the local session with %s closeout and does not infer full cleanup from an empty process scan",
  async (closeout) => {
    const fixture = await recoveryFixture();
    const session = fixture.failed.steps.find(
      (step) => step.id === "a",
    )?.session;
    if (!session) throw new Error("Synthetic session is missing");
    const run = patchRecoveryStep(fixture.failed, "a", {
      session: { ...session, closeout },
    });
    const world = recoveryWorld(fixture, run);
    const before = await world.recovery.view(run.userId, run.id);
    expect(before.cleanupResources).toEqual([
      { stepId: "a", kind: "local_session", closeout },
    ]);
    const original = world.database.run(run.id);
    await expect(
      releasePlanRun(world, run.userId, {
        operationId: `operation-${closeout}`,
        planId: run.planId,
        runId: run.id,
        expectedRecoveryRevision: before.revision,
      }),
    ).rejects.toMatchObject({ code: "cleanup_unconfirmed" });
    expect(endTaggedProcesses).toHaveBeenCalledWith(
      session.instanceId,
      expect.anything(),
    );
    expect(world.database.run(run.id)).toEqual(original);
    expect(world.database.stored().locks.get("workspace")).toBe(run.id);
    expect(world.database.stored().executions).toHaveLength(0);
    expect(world.start).not.toHaveBeenCalled();
  },
);

it("names a denied scan of an unconfirmed local session and keeps its reservation", async () => {
  const fixture = await recoveryFixture();
  const session = fixture.failed.steps.find((step) => step.id === "a")?.session;
  if (!session) throw new Error("Synthetic session is missing");
  const run = patchRecoveryStep(fixture.failed, "a", {
    session: { ...session, closeout: "failed" },
  });
  const world = recoveryWorld(fixture, run);
  vi.mocked(endTaggedProcesses).mockRejectedValueOnce(
    Object.assign(new Error("Private process text"), { code: "EPERM" }),
  );

  await expect(
    releasePlanRun(world, run.userId, {
      operationId: "session-scan-denied",
      planId: run.planId,
      runId: run.id,
      expectedRecoveryRevision: 0,
    }),
  ).rejects.toMatchObject({
    code: "cleanup_unconfirmed",
    cleanupFailure: {
      stepId: "a",
      kind: "local_session",
      reason: "scan_access_denied",
    },
  });
  expect(world.database.stored().locks.get("workspace")).toBe(run.id);
  expect(world.database.stored().executions).toHaveLength(0);
});

it("distinguishes a remote attempt and a loop without exposing their process identities", async () => {
  const remote = await remoteCompletion(false);
  const loop = {
    ...initialLoopRun(emptyPlanLoop("loop", "Synthetic", { x: 0, y: 0 })),
    cleanup: "failed" as const,
  };
  const resources = planCleanupResources({ ...remote.run, loops: [loop] });
  expect(resources).toEqual([
    {
      stepId: remote.run.steps[0].id,
      kind: "remote_attempt",
      closeout: "unknown",
    },
    { stepId: "loop", kind: "loop", closeout: "failed" },
  ]);
  expect(JSON.stringify(resources)).not.toContain("instanceId");
  expect(JSON.stringify(resources)).not.toContain("sessionId");
  expect(JSON.stringify(resources)).not.toContain("jobId");
});

it("does not report historical unconfirmed records as held after the reservation is gone", async () => {
  const fixture = await recoveryFixture();
  const session = fixture.failed.steps.find((step) => step.id === "a")?.session;
  if (!session) throw new Error("Synthetic session is missing");
  const run = patchRecoveryStep(fixture.failed, "a", {
    session: { ...session, closeout: "failed" },
  });
  const world = recoveryWorld(fixture, run);
  await world.database
    .asDatabase()
    .execute("DELETE FROM agent_plan_workspace_locks WHERE run_id = $run_id;", {
      run_id: run.id,
    });
  const view = await world.recovery.view(run.userId, run.id);
  expect(view.isCleanupUnconfirmed).toBe(false);
  expect(view.cleanupResources).toEqual([]);
});

it("names an affected loop member while filtering credential-shaped text", async () => {
  const fixture = await recoveryFixture();
  const session = fixture.failed.steps.find((step) => step.id === "a")?.session;
  if (!session) throw new Error("Synthetic session is missing");
  const member = { ...fixture.snapshot.steps[0].step, id: "loop-member" };
  const loop = {
    ...emptyPlanLoop("loop", "Synthetic", { x: 0, y: 0 }),
    steps: [member],
  };
  let record = beginIteration(
    initialLoopRun(loop),
    loop,
    new Map([[member.id, "password=synthetic-value"]]),
  );
  record = patchIterationNode(
    record,
    { number: 1, nodeId: member.id },
    { session: { ...session, closeout: "failed" } },
  );
  const run = { ...fixture.failed, loops: [record] };
  const view = await recoveryWorld(fixture, run).recovery.view(
    run.userId,
    run.id,
  );
  expect(view.cleanupResources).toContainEqual({
    stepId: member.id,
    kind: "local_session",
    closeout: "failed",
  });
  expect(view.stepNames[member.id]).toContain("[redacted]");
  expect(JSON.stringify(view.stepNames)).not.toContain("synthetic-value");
  expect(planRecoveryEntry(view, false).cleanupResources).toContainEqual({
    stepId: member.id,
    stepName: "[redacted]",
    kind: "local_session",
    closeout: "failed",
  });
});

it("rechecks the continuation's owner and plan, and preserves unexpected errors", async () => {
  const fixture = await recoveryFixture();
  const world = recoveryWorld(fixture, fixture.failed);
  const view = await world.recovery.view(
    fixture.failed.userId,
    fixture.failed.id,
  );
  const continued = { ...view, continuedBy: "synthetic-new-run" };
  const run = vi.fn(async () => ({
    ...fixture.failed,
    id: continued.continuedBy,
  }));
  await expect(
    canReadPlanContinuation({ run }, fixture.failed.userId, view),
  ).resolves.toBe(false);
  expect(run).not.toHaveBeenCalled();
  await expect(
    canReadPlanContinuation({ run }, fixture.failed.userId, continued),
  ).resolves.toBe(true);
  expect(run).toHaveBeenCalledWith(
    fixture.failed.userId,
    continued.continuedBy,
  );
  run.mockResolvedValueOnce({ ...fixture.failed, planId: "another-plan" });
  await expect(
    canReadPlanContinuation({ run }, fixture.failed.userId, continued),
  ).resolves.toBe(false);
  run.mockRejectedValueOnce(new AgentError("plan_access_denied"));
  await expect(
    canReadPlanContinuation({ run }, fixture.failed.userId, continued),
  ).resolves.toBe(false);
  run.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(
    canReadPlanContinuation({ run }, fixture.failed.userId, continued),
  ).rejects.toThrow("database unavailable");
});

it("projects a linked continuation only when that run can be read", async () => {
  const fixture = await recoveryFixture();
  const world = recoveryWorld(fixture, fixture.failed);
  const view = await world.recovery.view(
    fixture.failed.userId,
    fixture.failed.id,
  );
  const continued = { ...view, continuedBy: "synthetic-new-run" };
  expect(planRecoveryEntry(continued, true)).toMatchObject({
    continuedBy: "synthetic-new-run",
    continuationStatus: "available",
  });
  expect(planRecoveryEntry(continued, false)).toMatchObject({
    continuedBy: null,
    continuationStatus: "unavailable",
  });
  expect(planRecoveryEntry(view, false)).toMatchObject({
    continuedBy: null,
    continuationStatus: "none",
  });
});
