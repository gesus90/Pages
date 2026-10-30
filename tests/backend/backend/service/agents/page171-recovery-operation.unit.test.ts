import { expect, it, vi } from "vitest";

import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import { translatePlanError } from "@/backend/service/agents/AgentPlanOperationErrors";
import { releasePlanRun } from "@/backend/service/agents/AgentPlanRecoveryOperation";
import { startRecoveredPlanRun } from "@/backend/service/agents/AgentPlanRecoveryStartOperation";
import { createPlanCheckpoint } from "@/backend/service/agents/recovery/AgentPlanCheckpoint";
import {
  endTaggedProcesses,
  findTaggedProcesses,
} from "@/backend/agents/cli/CliProcessScan";
import { removeScriptResources } from "@/backend/service/agents/AgentPlanScriptResources";

import { PlanWorld } from "./plan-operation-world";
import { patchRecoveryStep, recoveryFixture } from "./page84-recovery-fixture";
import { recoveryWorld } from "./page171-recovery-world";

import type * as CliProcessScan from "@/backend/agents/cli/CliProcessScan";
import type * as ScriptResources from "@/backend/service/agents/AgentPlanScriptResources";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import type { RecoveryFixture } from "./page84-recovery-fixture";
import type { AgentPlanRecoveryService } from "@/backend/service/agents/recovery/AgentPlanRecoveryService";

vi.mock("@/backend/agents/cli/CliProcessScan", async (importOriginal) => {
  const original = await importOriginal<typeof CliProcessScan>();
  return {
    ...original,
    readScopeSince: vi.fn(async () => ({ earliestStart: 0 })),
    findTaggedProcesses: vi.fn(async () => []),
    endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
  };
});

vi.mock(
  "@/backend/service/agents/AgentPlanScriptResources",
  async (importOriginal) => {
    const original = await importOriginal<typeof ScriptResources>();
    return { ...original, removeScriptResources: vi.fn(async () => undefined) };
  },
);

function failedScriptRun(fixture: RecoveryFixture): AgentPlanRun {
  const run = patchRecoveryStep(fixture.failed, "a", { session: null });
  return patchRecoveryStep(run, "b", {
    script: {
      attemptId: "17b99dfa-d3fb-470a-b204-8dcaee627667",
      instanceId: "5b7f02ca-5f61-4e3c-bba2-19e6cd07494d",
      interpreterProfileId: "synthetic",
      directory: "/synthetic",
      userId: run.userId,
      uid: 1000,
      gid: 1000,
      processId: null,
      startedAt: run.startedAt,
      endedAt: null,
      exitCode: null,
      signal: null,
      failure: "cleanup",
      closeout: "failed",
      stdout: null,
      stderr: "",
    },
  });
}

it("requests cleanup through the existing recovery command without starting a run", async () => {
  const fixture = await recoveryFixture();
  const run = { ...fixture.failed, planId: "plan-1" };
  const control = vi.fn<AgentPlanRecoveryService["control"]>(async () => ({
    commandId: "cleanup-1",
    revision: 1,
    outcome: "released" as const,
  }));
  const services = { plans: { run: async () => run }, recovery: { control } };
  const input = {
    operationId: "operation-1",
    planId: "plan-1",
    runId: run.id,
    expectedRecoveryRevision: 0,
  };

  await expect(releasePlanRun(services, "owner", input)).resolves.toEqual({
    planId: "plan-1",
    runId: run.id,
    commandId: "cleanup-1",
    recoveryRevision: 1,
    outcome: "released",
  });
  await releasePlanRun(services, "owner", input);
  expect(control).toHaveBeenCalledTimes(2);
  expect(control.mock.calls[0]).toEqual(control.mock.calls[1]);
  expect(control.mock.calls[0]?.[2]).toMatchObject({
    action: "release",
    expectedRevision: 0,
  });
});

it("does not send cleanup to a run of a different plan", async () => {
  const fixture = await recoveryFixture();
  const control = vi.fn<AgentPlanRecoveryService["control"]>();

  await expect(
    releasePlanRun(
      { plans: { run: async () => fixture.failed }, recovery: { control } },
      "owner",
      {
        operationId: "operation-1",
        planId: "another-plan",
        runId: fixture.failed.id,
        expectedRecoveryRevision: 0,
      },
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(control).not.toHaveBeenCalled();
});

it("keeps recovery cleanup unavailable to run-scoped credentials", async () => {
  const world = new PlanWorld();
  const identity = {
    ...world.identity("owner"),
    run: {
      runId: "session-run",
      stepId: "session-step",
      operations: [],
      tickets: [],
      reach: "full" as const,
    },
  };

  await expect(
    world.operations.handle(identity, "plans.run.recovery.release", {}),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

it("reports unconfirmed cleanup and stale recovery revisions as distinct refusals", () => {
  expect(
    translatePlanError(new AgentPlanRecoveryError("cleanup_unconfirmed")),
  ).toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "plan_recovery_cleanup_unconfirmed" },
  });
  expect(
    translatePlanError(new AgentPlanRecoveryError("revision_conflict")),
  ).toMatchObject({
    code: "CONFLICT",
    details: { reason: "plan_recovery_revision_conflict" },
  });
});

it("maps only a fixed cleanup reason and the owned node to the agent API", () => {
  const cleanupFailure = {
    stepId: "a",
    kind: "local_session",
    reason: "scan_access_denied",
  } as const;
  expect(
    translatePlanError(
      new AgentPlanRecoveryError("cleanup_unconfirmed", cleanupFailure),
    ),
  ).toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "plan_recovery_cleanup_unconfirmed", cleanupFailure },
  });
});

it("journals an eligible release once and leaves another run's reservation untouched", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "a", { session: null });
  const world = recoveryWorld(fixture, run);
  const original = world.database.run(run.id);
  await world.database
    .asDatabase()
    .execute(
      "INSERT INTO agent_plan_workspace_locks (workspace_id, run_id) VALUES ($workspace_id, $run_id);",
      { workspace_id: "foreign", run_id: "other-run" },
    );
  const input = {
    operationId: "operation-1",
    planId: run.planId,
    runId: run.id,
    expectedRecoveryRevision: 0,
  };

  const before = await world.recovery.view(run.userId, run.id);
  const result = await releasePlanRun(world, run.userId, input);
  const repeated = await releasePlanRun(world, run.userId, input);
  const after = await world.recovery.view(run.userId, run.id);

  expect(before.release.available).toBe(true);
  expect(result).toEqual(repeated);
  expect(result).toMatchObject({ outcome: "released", recoveryRevision: 1 });
  expect(after.release).toEqual({
    available: false,
    reason: "nothing_to_release",
  });
  expect([...world.database.stored().locks.entries()]).toEqual([
    ["foreign", "other-run"],
  ]);
  expect(world.database.stored().executions).toHaveLength(1);
  expect(world.database.run(run.id)).toEqual(original);
  expect(world.start).not.toHaveBeenCalled();
  await expect(
    releasePlanRun(world, run.userId, {
      ...input,
      expectedRecoveryRevision: 1,
    }),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
});

it("journals an explicit restart once and rejects changed arguments under the same operation ID", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "a", { session: null });
  const world = recoveryWorld(fixture, run, { canStart: true });
  const original = world.database.run(run.id);
  const request = {
    operationId: "restart-original",
    planId: run.planId,
    runId: run.id,
    expectedRecoveryRevision: 0,
    expectedPlanRevision: fixture.snapshot.plan.revision,
    confirmRepeat: true,
  };

  const first = await startRecoveredPlanRun(
    world,
    run.userId,
    "restart",
    request,
  );
  const replay = await startRecoveredPlanRun(
    world,
    run.userId,
    "restart",
    request,
  );
  expect(first).toEqual(replay);
  expect(first).toMatchObject({
    outcome: "started",
    startedRunId: "synthetic-new-run",
  });
  expect(world.start).toHaveBeenCalledOnce();
  expect(world.database.run(run.id)).toEqual(original);
  expect(world.database.stored().executions).toHaveLength(1);
  await expect(
    startRecoveredPlanRun(world, run.userId, "restart", {
      ...request,
      expectedPlanRevision: request.expectedPlanRevision + 1,
    }),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
  await expect(
    startRecoveredPlanRun(world, run.userId, "resume", {
      operationId: request.operationId,
      planId: request.planId,
      runId: request.runId,
      expectedRecoveryRevision: request.expectedRecoveryRevision,
      expectedPlanRevision: request.expectedPlanRevision,
      mode: "new_session",
      reviewedStepIds: [],
    }),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
  expect(world.start).toHaveBeenCalledOnce();
});

it("requires reviewed effects before a recovery continuation can start", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "a", {
    status: "failed",
    output: null,
    error: "plan_interrupted",
  });
  const world = recoveryWorld(fixture, run, { canStart: true });

  await expect(
    startRecoveredPlanRun(world, run.userId, "resume", {
      operationId: "continue-unreviewed",
      planId: run.planId,
      runId: run.id,
      expectedRecoveryRevision: 0,
      expectedPlanRevision: fixture.snapshot.plan.revision,
      mode: "new_session",
      reviewedStepIds: [],
    }),
  ).rejects.toMatchObject({ code: "review_required" });
  expect(world.start).not.toHaveBeenCalled();
  expect([...world.database.stored().locks.values()]).toContain(run.id);
});

it("reuses a verified completion in one reviewed continuation and replays its receipt", async () => {
  const fixture = await recoveryFixture();
  const completedSession = fixture.failed.steps.find(
    (step) => step.id === "a",
  )?.session;
  if (!completedSession) throw new Error("Synthetic session is missing");
  const run = patchRecoveryStep(fixture.failed, "b", {
    session: { ...completedSession, instanceId: "second-synthetic-session" },
  });
  const world = recoveryWorld(fixture, run, { canStart: true });
  const original = world.database.run(run.id);
  const db = world.database.asDatabase();
  const checkpoints = new AgentPlanCheckpointRepository(db);
  await db.transaction((transaction) =>
    checkpoints.append(
      transaction,
      createPlanCheckpoint(run, fixture.snapshot, "a"),
      0,
    ),
  );
  const request = {
    operationId: "continue-reviewed",
    planId: run.planId,
    runId: run.id,
    expectedRecoveryRevision: 0,
    expectedPlanRevision: fixture.snapshot.plan.revision,
    mode: "new_session",
    reviewedStepIds: ["b"],
  };

  const first = await startRecoveredPlanRun(
    world,
    run.userId,
    "resume",
    request,
  );
  const replay = await startRecoveredPlanRun(
    world,
    run.userId,
    "resume",
    request,
  );
  expect(first).toEqual(replay);
  expect(first).toMatchObject({
    outcome: "started",
    action: "resume",
    startedRunId: "synthetic-new-run",
  });
  expect(world.start).toHaveBeenCalledOnce();
  expect(vi.mocked(world.start).mock.calls[0]?.[2]).toMatchObject({
    origin: { reusedStepIds: ["a"], retriedStepIds: ["b"] },
    reused: [{ id: "a", status: "succeeded", output: "immutable A result" }],
  });
  expect(world.database.run(run.id)).toEqual(original);
  expect(world.database.stored().executions).toHaveLength(1);
  expect(world.database.stored().checkpoints).toHaveLength(2);
});

it("denies read-only restart but preserves owner and cleanup identity for a reviewed active restart", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "a", { session: null });
  for (const options of [{ canEdit: false }, { engineActive: true }]) {
    const world = recoveryWorld(fixture, run, { ...options, canStart: true });
    const command = startRecoveredPlanRun(world, run.userId, "restart", {
      operationId: "restart-reviewed",
      planId: run.planId,
      runId: run.id,
      expectedRecoveryRevision: 0,
      expectedPlanRevision: fixture.snapshot.plan.revision,
      confirmRepeat: true,
    });
    if ("canEdit" in options) {
      await expect(command).rejects.toMatchObject({
        code: "action_unavailable",
      });
      expect(world.start).not.toHaveBeenCalled();
    } else {
      await expect(command).resolves.toMatchObject({
        outcome: "started",
        runId: run.id,
      });
      expect(world.start).toHaveBeenCalledOnce();
      expect(vi.mocked(world.start).mock.calls[0]?.[1].recovery).toMatchObject({
        sourceRunId: run.id,
        isRestart: true,
        contextByStepId: {},
        resumeSessions: {},
      });
      expect(vi.mocked(world.start).mock.calls[0]?.[2]).toMatchObject({
        origin: { kind: "restart", runId: run.id },
        reused: [],
      });
    }
    expect([...world.database.stored().locks.values()]).toContain(run.id);
  }
});

it("refuses an unconfirmed session and preserves the run and its reservation", async () => {
  const fixture = await recoveryFixture();
  const session = fixture.failed.steps.find((step) => step.id === "a")?.session;
  if (!session) throw new Error("Synthetic session is missing");
  const run = patchRecoveryStep(fixture.failed, "a", {
    session: { ...session, closeout: "failed" },
  });
  const world = recoveryWorld(fixture, run);
  const original = world.database.run(run.id);

  await expect(
    releasePlanRun(world, run.userId, {
      operationId: "operation-unsafe",
      planId: run.planId,
      runId: run.id,
      expectedRecoveryRevision: 0,
    }),
  ).rejects.toMatchObject({ code: "cleanup_unconfirmed" });
  expect([...world.database.stored().locks.values()]).toContain(run.id);
  expect(world.database.stored().executions).toHaveLength(0);
  expect(world.database.run(run.id)).toEqual(original);
  expect(world.start).not.toHaveBeenCalled();
});

it("denies cleanup after the executor loses edit rights", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "a", { session: null });
  const world = recoveryWorld(fixture, run, { canEdit: false });
  const before = await world.recovery.view(run.userId, run.id);

  expect(before.release).toEqual({
    available: false,
    reason: "plan_read_only",
  });
  await expect(
    releasePlanRun(world, run.userId, {
      operationId: "operation-read-only",
      planId: run.planId,
      runId: run.id,
      expectedRecoveryRevision: before.revision,
    }),
  ).rejects.toMatchObject({ code: "action_unavailable" });
  expect([...world.database.stored().locks.values()]).toContain(run.id);
  expect(world.database.stored().executions).toHaveLength(0);
  expect(world.start).not.toHaveBeenCalled();
});

it("refuses recovery continuation when the selected saved plan revision is stale", async () => {
  const fixture = await recoveryFixture();
  const run = fixture.failed;
  const world = recoveryWorld(fixture, run);
  const original = world.database.run(run.id);

  await expect(
    startRecoveredPlanRun(world, run.userId, "resume", {
      operationId: "operation-stale-plan",
      planId: run.planId,
      runId: run.id,
      expectedRecoveryRevision: 0,
      expectedPlanRevision: fixture.snapshot.plan.revision + 1,
      mode: "new_session",
      reviewedStepIds: ["b"],
    }),
  ).rejects.toMatchObject({ code: "plan_conflict" });
  expect(world.start).not.toHaveBeenCalled();
  expect(world.database.run(run.id)).toEqual(original);
  expect([...world.database.stored().locks.values()]).toContain(run.id);
});

it("does not execute an older continuation request without a selected plan revision", async () => {
  const fixture = await recoveryFixture();
  const run = fixture.failed;
  const world = recoveryWorld(fixture, run);

  await expect(
    world.recovery.control(run.userId, run.id, {
      action: "resume",
      mode: "new_session",
      reviewedStepIds: ["b"],
      expectedRevision: 0,
      idempotencyKey: "old-client-request",
    }),
  ).rejects.toMatchObject({ code: "plan_conflict" });
  expect(world.start).not.toHaveBeenCalled();
  expect([...world.database.stored().locks.values()]).toContain(run.id);
});

it("does not offer release while a terminal run's engine still owns its processes", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "a", { session: null });
  const world = recoveryWorld(fixture, run, { engineActive: true });
  const before = await world.recovery.view(run.userId, run.id);

  expect(before.release).toEqual({ available: false, reason: "run_active" });
  await expect(
    releasePlanRun(world, run.userId, {
      operationId: "operation-engine-active",
      planId: run.planId,
      runId: run.id,
      expectedRecoveryRevision: before.revision,
    }),
  ).rejects.toMatchObject({ code: "action_unavailable" });
  expect([...world.database.stored().locks.values()]).toContain(run.id);
  expect(world.database.stored().executions).toHaveLength(0);
});

it("keeps the reservation when a process scan fails", async () => {
  const fixture = await recoveryFixture();
  const run = fixture.failed;
  const world = recoveryWorld(fixture, run);
  vi.mocked(findTaggedProcesses).mockRejectedValueOnce(
    new Error("Synthetic scan failure"),
  );

  await expect(
    releasePlanRun(world, run.userId, {
      operationId: "operation-scan",
      planId: run.planId,
      runId: run.id,
      expectedRecoveryRevision: 0,
    }),
  ).rejects.toMatchObject({
    code: "cleanup_unconfirmed",
    cleanupFailure: {
      stepId: "a",
      kind: "local_session",
      reason: "scan_unavailable",
    },
  });
  expect([...world.database.stored().locks.values()]).toContain(run.id);
  expect(world.database.stored().executions).toHaveLength(0);
  expect(world.start).not.toHaveBeenCalled();
});

it("retries an owned script closeout without rewriting the historical failure", async () => {
  const fixture = await recoveryFixture();
  const instanceId = "5b7f02ca-5f61-4e3c-bba2-19e6cd07494d";
  const run = failedScriptRun(fixture);
  const world = recoveryWorld(fixture, run);
  const original = world.database.run(run.id);
  const input = {
    operationId: "operation-script-cleanup",
    planId: run.planId,
    runId: run.id,
    expectedRecoveryRevision: 0,
  };

  const released = await releasePlanRun(world, run.userId, input);
  expect(released.outcome).toBe("released");
  expect(await releasePlanRun(world, run.userId, input)).toEqual(released);
  expect(removeScriptResources).toHaveBeenCalledWith(instanceId);
  expect(world.database.run(run.id)).toEqual(original);
  expect(world.database.stored().locks.has("workspace")).toBe(false);
  expect(world.start).not.toHaveBeenCalled();
});

it("retains the script's workspace if its cleanup scan cannot confirm closure", async () => {
  const fixture = await recoveryFixture();
  const run = failedScriptRun(fixture);
  const world = recoveryWorld(fixture, run);
  const original = world.database.run(run.id);
  vi.mocked(removeScriptResources).mockClear();
  vi.mocked(endTaggedProcesses).mockRejectedValueOnce(
    Object.assign(new Error("Synthetic private scan detail"), {
      code: "EACCES",
    }),
  );

  await expect(
    releasePlanRun(world, run.userId, {
      operationId: "operation-script-unsafe",
      planId: run.planId,
      runId: run.id,
      expectedRecoveryRevision: 0,
    }),
  ).rejects.toMatchObject({
    code: "cleanup_unconfirmed",
    cleanupFailure: {
      stepId: "b",
      kind: "local_script",
      reason: "scan_access_denied",
    },
  });
  expect(removeScriptResources).not.toHaveBeenCalled();
  expect(world.database.run(run.id)).toEqual(original);
  expect(world.database.stored().locks.get("workspace")).toBe(run.id);
  expect(world.start).not.toHaveBeenCalled();
});

it("keeps the workspace until the run's ACP leases are also confirmed closed", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "a", { session: null });
  let remaining = 1;
  let owner = run.id;
  const resources: Pick<AcpResourceScheduler, "reconcile" | "snapshot"> = {
    reconcile: vi.fn(async () => remaining),
    snapshot: () => ({
      options: {
        maxConcurrentAcpSessions: 1,
        memoryAwareScheduling: false,
        minimumAvailableMemory: 0,
        acpIdleTimeout: 60_000,
        queueDiscipline: "fifo",
      },
      limitSource: "default",
      availableMemory: null,
      problem: null,
      active: [
        {
          instanceId: "synthetic-instance",
          userId: run.userId,
          provider: "codex_cli",
          runId: owner,
          stepId: "a",
          state: "cleanup_failed",
          since: run.startedAt,
          isPaused: false,
        },
      ],
      waiting: [],
    }),
  };
  const world = recoveryWorld(fixture, run, { resources });
  const input = {
    operationId: "operation-acp",
    planId: run.planId,
    runId: run.id,
    expectedRecoveryRevision: 0,
  };

  await expect(releasePlanRun(world, run.userId, input)).rejects.toMatchObject({
    code: "cleanup_unconfirmed",
  });
  expect([...world.database.stored().locks.values()]).toContain(run.id);
  remaining = 0;
  await expect(releasePlanRun(world, run.userId, input)).rejects.toMatchObject({
    code: "cleanup_unconfirmed",
  });
  expect([...world.database.stored().locks.values()]).toContain(run.id);
  owner = "foreign-run";
  await expect(releasePlanRun(world, run.userId, input)).resolves.toMatchObject(
    {
      outcome: "released",
    },
  );
  expect(resources.reconcile).toHaveBeenCalledWith(run.id);
  expect(world.start).not.toHaveBeenCalled();
});
