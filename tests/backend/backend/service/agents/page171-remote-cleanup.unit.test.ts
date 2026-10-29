import { expect, it, vi } from "vitest";

import { AgentPlanRecoveryExecutionRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository";
import { AgentPlanProgressRepository } from "@/backend/database/repositories/agent/AgentPlanProgressRepository";
import { AgentPlanRecoveryActions } from "@/backend/service/agents/recovery/AgentPlanRecoveryActions";
import { hasNoSessionProcesses } from "@/backend/service/agents/AgentPlanRecovery";
import { isOriginalRemoteJob } from "@/backend/service/agents/AgentPlanRemoteCancellation";
import { settleDetachedRun } from "@/backend/service/agents/AgentPlanRunState";
import { runnerStoppedRun } from "@/backend/service/runner/RunnerStopState";
import { applyRunnerMessage } from "@/backend/service/runner/RunnerProtocol";
import { findTaggedProcesses } from "@/backend/agents/cli/CliProcessScan";

import { RecoveryDatabase } from "./page84-recovery-database";
import { patchRecoveryStep, recoveryFixture } from "./page84-recovery-fixture";

import type { AgentPlanStepExecution } from "@/definition/AgentPlanExecution";
import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";
import type { RunnerJob, RunnerState } from "@/definition/RunnerProtocol";
import type { RecoveryExecutionWrite } from "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository";
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

const EXECUTION: AgentPlanStepExecution = {
  schemaVersion: 1,
  planId: "plan",
  runId: "run",
  stepId: "b",
  attemptId: "17b99dfa-d3fb-470a-b204-8dcaee627667",
  planRevision: 1,
  target: {
    kind: "remote",
    connectionId: "connection",
    connectionRevision: 1,
    connectionName: "Synthetic host",
    workspaceId: "workspace",
    workspaceRevision: 1,
    workspaceName: "Synthetic workspace",
    path: "/synthetic",
  },
  workspace: { id: "workspace", path: "/synthetic", revision: 1 },
  modelAccess: {
    connectionId: null,
    connectionName: "",
    provider: "synthetic",
    model: "synthetic",
    reasoningEffort: null,
  },
};

const RELEASE: RecoveryExecutionWrite = {
  command: {
    action: "release",
    expectedRevision: 0,
    idempotencyKey: "cleanup-1",
  },
  requestDigest: "synthetic-digest",
  execution: {
    id: "release",
    runId: "run",
    userId: "owner",
    action: "release",
    targetRunId: null,
    origin: null,
    revision: 1,
    createdAt: "2026-10-28T08:00:00.000Z",
  },
  result: { commandId: "release", revision: 1, outcome: "released" },
};

it("uses a confirmed owned namespace closeout without scanning process environments", async () => {
  const fixture = await recoveryFixture();
  const original = fixture.completed.steps.find(
    (step) => step.id === "a",
  )?.session;
  if (!original) throw new Error("Missing session fixture");
  const run = patchRecoveryStep(fixture.completed, "a", {
    session: {
      ...original,
      runner: "antigravity",
      containment: "pid_namespace",
    },
  });
  vi.mocked(findTaggedProcesses).mockClear();
  await expect(hasNoSessionProcesses(run)).resolves.toBe(true);
  expect(findTaggedProcesses).not.toHaveBeenCalled();
});

it("does not trust namespace evidence for an API request", async () => {
  const fixture = await recoveryFixture();
  const original = fixture.completed.steps.find(
    (step) => step.id === "a",
  )?.session;
  if (!original) throw new Error("Missing session fixture");
  const run = patchRecoveryStep(fixture.completed, "a", {
    session: { ...original, runner: "api", containment: "pid_namespace" },
  });
  vi.mocked(findTaggedProcesses).mockClear();
  await expect(hasNoSessionProcesses(run)).resolves.toBe(true);
  expect(findTaggedProcesses).toHaveBeenCalledOnce();
});

it("does not require a process boundary for a completed API request", async () => {
  const fixture = await recoveryFixture();
  const original = fixture.completed.steps.find(
    (step) => step.id === "a",
  )?.session;
  if (!original) throw new Error("Missing session fixture");
  const run = patchRecoveryStep(fixture.completed, "a", {
    session: {
      ...original,
      runner: "api",
      mode: "request",
      processId: null,
      closeout: "not_needed",
    },
  });
  vi.mocked(findTaggedProcesses).mockClear();
  await expect(hasNoSessionProcesses(run)).resolves.toBe(true);
  expect(findTaggedProcesses).not.toHaveBeenCalled();
});

it.each(["failed", "open"] as const)(
  "retains a workspace when a loop has %s cleanup evidence",
  async (kind) => {
    const fixture = await recoveryFixture();
    const loop: AgentPlanLoopRun = {
      id: "loop",
      name: "Synthetic loop",
      status: "failed",
      count: null,
      sessionPolicy: "reuse",
      condition: null,
      iterations: [],
      sessions: [
        {
          nodeId: "member",
          key: "run/loop/member",
          policy: "reuse",
          state: kind === "open" ? "open" : "lost",
          createdInIteration: 1,
          turns: 1,
          instanceId: "owned-loop-instance",
          acpSessionId: null,
          nativeSessionId: null,
          closeout: kind === "open" ? "not_needed" : "failed",
        },
      ],
      completion: null,
      cleanup: kind === "open" ? "not_needed" : "failed",
      startedAt: fixture.failed.startedAt,
      endedAt: null,
      error: "plan_closeout_failed",
    };
    const run = { ...fixture.failed, loops: [loop] };
    const database = new RecoveryDatabase(fixture.snapshot, run);
    const progress = new AgentPlanProgressRepository(database.asDatabase());

    await progress.update(run);

    expect(database.stored().locks.get("workspace")).toBe(run.id);
    await expect(hasNoSessionProcesses(run)).resolves.toBe(false);
    expect(
      settleDetachedRun({ ...run, status: "stopping", stopRequested: true })
        .status,
    ).toBe("failed");
  },
);

it("allows release after a loop's session and cleanup are confirmed closed", async () => {
  const fixture = await recoveryFixture();
  const loop: AgentPlanLoopRun = {
    id: "loop",
    name: "Synthetic loop",
    status: "failed",
    count: null,
    sessionPolicy: "reuse",
    condition: null,
    iterations: [],
    sessions: [
      {
        nodeId: "member",
        key: "run/loop/member",
        policy: "reuse",
        state: "closed",
        createdInIteration: 1,
        turns: 1,
        instanceId: "owned-loop-instance",
        acpSessionId: null,
        nativeSessionId: null,
        closeout: "confirmed",
      },
    ],
    completion: null,
    cleanup: "confirmed",
    startedAt: fixture.failed.startedAt,
    endedAt: null,
    error: "plan_interrupted",
  };
  const run = { ...fixture.failed, loops: [loop] };
  const database = new RecoveryDatabase(fixture.snapshot, run);
  const progress = new AgentPlanProgressRepository(database.asDatabase());

  await progress.update(run);

  expect(database.stored().locks.has("workspace")).toBe(false);
  vi.mocked(findTaggedProcesses).mockClear();
  await expect(hasNoSessionProcesses(run)).resolves.toBe(true);
  expect(findTaggedProcesses).toHaveBeenCalledWith("owned-loop-instance", {
    earliestStart: 0,
  });
  vi.mocked(findTaggedProcesses)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([42]);
  await expect(hasNoSessionProcesses(run)).resolves.toBe(false);
});

it("retains a failed remote run's workspace when no closeout was reported without a stop request", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "b", { execution: EXECUTION });
  const database = new RecoveryDatabase(fixture.snapshot, run);
  const progress = new AgentPlanProgressRepository(database.asDatabase());

  await progress.update(run);

  expect(run.stopRequested).toBe(false);
  expect(database.stored().locks.get("workspace")).toBe("run");
});

it("retains a remote reservation when its original execution identity is missing", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "b", {
    remote: {
      jobId: "723f9296-f849-4bdf-8193-f557fc819198",
      sessionId: "b23c35f9-d2c0-4ae6-9bca-de8d0ba14246",
      status: "failed",
      startedAt: null,
      endedAt: null,
      closeout: "confirmed",
    },
  });
  const database = new RecoveryDatabase(fixture.snapshot, run);
  const progress = new AgentPlanProgressRepository(database.asDatabase());

  await progress.update(run);

  expect(database.stored().locks.get("workspace")).toBe(run.id);
  await expect(hasNoSessionProcesses(run)).resolves.toBe(false);
});

it("releases the terminal run's workspace after its remote closeout is confirmed", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "b", {
    execution: EXECUTION,
    remote: {
      jobId: "723f9296-f849-4bdf-8193-f557fc819198",
      sessionId: "b23c35f9-d2c0-4ae6-9bca-de8d0ba14246",
      status: "failed",
      startedAt: null,
      endedAt: null,
      closeout: "confirmed",
    },
  });
  const database = new RecoveryDatabase(fixture.snapshot, run);
  const progress = new AgentPlanProgressRepository(database.asDatabase());

  await progress.update(run);

  expect(database.stored().locks.has("workspace")).toBe(false);
});

it("does not require remote closeout for a blocked node that never started", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "c", {
    execution: { ...EXECUTION, stepId: "c" },
    isBlocked: true,
    error: "plan_dependency_failed",
  });
  const database = new RecoveryDatabase(fixture.snapshot, run);
  const progress = new AgentPlanProgressRepository(database.asDatabase());

  await progress.update(run);

  expect(database.stored().locks.has("workspace")).toBe(false);
  await expect(hasNoSessionProcesses(run)).resolves.toBe(true);
});

it("recognizes an explicitly cancelled, never-started remote node", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "c", {
    execution: { ...EXECUTION, stepId: "c" },
    status: "cancelled",
    cancellation: "not_started",
  });
  const database = new RecoveryDatabase(fixture.snapshot, run);
  const progress = new AgentPlanProgressRepository(database.asDatabase());

  await progress.update(run);

  expect(database.stored().locks.has("workspace")).toBe(false);
  await expect(hasNoSessionProcesses(run)).resolves.toBe(true);
});

it("keeps a reservation when remote progress contradicts a never-started state", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "c", {
    execution: { ...EXECUTION, stepId: "c" },
    remote: {
      jobId: "723f9296-f849-4bdf-8193-f557fc819198",
      sessionId: "b23c35f9-d2c0-4ae6-9bca-de8d0ba14246",
      status: "lost",
      startedAt: null,
      endedAt: null,
      closeout: "pending",
    },
    status: "cancelled",
    cancellation: "not_started",
  });
  const database = new RecoveryDatabase(fixture.snapshot, run);
  const progress = new AgentPlanProgressRepository(database.asDatabase());

  await progress.update(run);

  expect(database.stored().locks.get("workspace")).toBe("run");
  await expect(hasNoSessionProcesses(run)).resolves.toBe(false);
});

it("only targets the job bound to the original plan, node, attempt and session", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "b", { execution: EXECUTION });
  const step = run.steps.find((entry) => entry.id === "b");
  if (!step) throw new Error("Synthetic remote step is missing");
  const binding = {
    planId: run.planId,
    runId: run.id,
    stepId: step.id,
    attemptId: EXECUTION.attemptId,
    planRevision: EXECUTION.planRevision,
  };
  const job: RunnerJob = {
    jobId: "723f9296-f849-4bdf-8193-f557fc819198",
    sessionId: "b23c35f9-d2c0-4ae6-9bca-de8d0ba14246",
    status: "running",
    plan: binding,
  };
  const progress = {
    jobId: job.jobId,
    sessionId: job.sessionId,
    status: "running" as const,
    startedAt: null,
    endedAt: null,
    closeout: "pending" as const,
  };

  expect(isOriginalRemoteJob(run, step, job)).toBe(true);
  expect(isOriginalRemoteJob(run, { ...step, remote: progress }, job)).toBe(
    true,
  );
  expect(
    isOriginalRemoteJob(run, step, {
      ...job,
      plan: { ...binding, stepId: "foreign" },
    }),
  ).toBe(false);
  expect(
    isOriginalRemoteJob(
      run,
      { ...step, remote: progress },
      {
        ...job,
        sessionId: "f7ca78ed-9168-4878-9c3d-f4c45b45414e",
      },
    ),
  ).toBe(false);
});

it("records confirmed remote cleanup after a terminal failure without a previous stop request", async () => {
  const fixture = await recoveryFixture();
  const remote = {
    jobId: "723f9296-f849-4bdf-8193-f557fc819198",
    sessionId: "b23c35f9-d2c0-4ae6-9bca-de8d0ba14246",
    status: "failed" as const,
    startedAt: null,
    endedAt: "2026-10-28T07:55:00.000Z",
    closeout: "failed" as const,
  };
  const run = patchRecoveryStep(fixture.failed, "b", {
    execution: EXECUTION,
    remote,
  });
  const time = "2026-10-28T08:00:00.000Z";
  const cancellation = {
    requestedAt: time,
    receivedAt: time,
    completedAt: time,
    closeout: "confirmed" as const,
  };
  const job: RunnerJob = {
    jobId: remote.jobId,
    sessionId: remote.sessionId,
    status: "failed",
    plan: {
      planId: run.planId,
      runId: run.id,
      stepId: "b",
      attemptId: EXECUTION.attemptId,
      planRevision: EXECUTION.planRevision,
    },
    cancellation: { requestedAt: time },
  };
  const state: RunnerState = {
    version: 1,
    sessionId: job.sessionId,
    sequence: 0,
    lastEventId: null,
    jobs: [job],
  };
  const message = {
    version: 1 as const,
    type: "stop-result" as const,
    sessionId: job.sessionId,
    jobId: job.jobId,
    attemptId: EXECUTION.attemptId,
    cancellation,
  };
  expect(() =>
    applyRunnerMessage(state, { ...message, attemptId: "foreign" }),
  ).toThrow("Runner stop evidence binding mismatch");
  const received = applyRunnerMessage(state, message).state.jobs[0];
  if (!received) throw new Error("Synthetic remote job is missing");

  expect(runnerStoppedRun(run, received, true, "foreign")).toBe(run);
  const active = { ...run, status: "running" as const };
  expect(runnerStoppedRun(active, received, false, "connection")).toBe(active);
  const failed = runnerStoppedRun(
    run,
    { ...received, cancellation: { ...cancellation, closeout: "failed" } },
    true,
    "connection",
  );
  expect(failed.steps.find((step) => step.id === "b")).toMatchObject({
    status: "failed",
    error: "plan_group_acceptance_failed",
    remote: { closeout: "failed" },
  });
  const updated = runnerStoppedRun(run, received, true, "connection");

  expect(run.stopRequested).toBe(false);
  expect(updated.status).toBe("failed");
  expect(updated.steps.find((step) => step.id === "b")).toMatchObject({
    status: "failed",
    error: "plan_group_acceptance_failed",
    remote: { closeout: "confirmed", endedAt: remote.endedAt },
  });
  expect(runnerStoppedRun(updated, received, true, "connection")).toBe(updated);
  const database = new RecoveryDatabase(fixture.snapshot, run);
  const progress = new AgentPlanProgressRepository(database.asDatabase());
  await database
    .asDatabase()
    .transaction((transaction) => progress.persist(transaction, updated));
  expect(database.stored().locks.has("workspace")).toBe(false);
  expect(database.run(run.id).status).toBe("failed");
});

it("requests cleanup for the original remote attempt after a failed run without a stop request", async () => {
  const fixture = await recoveryFixture();
  const run = patchRecoveryStep(fixture.failed, "b", { execution: EXECUTION });
  let storedRun = run;
  const database = new RecoveryDatabase(fixture.snapshot, run);
  const executions = new AgentPlanRecoveryExecutionRepository(
    database.asDatabase(),
  );
  vi.spyOn(executions, "replay").mockResolvedValue(null);
  vi.spyOn(executions, "source").mockImplementation(async () => ({
    run: storedRun,
    revision: 0,
    snapshot: fixture.snapshot,
  }));
  vi.spyOn(executions, "list").mockResolvedValue([]);
  const record = vi.spyOn(executions, "recordAlone").mockResolvedValue();
  const cleanupRemote = vi.fn(async () => undefined);
  const release = vi.fn(async () => undefined);
  const actions = new AgentPlanRecoveryActions({
    runs: { run: async () => storedRun },
    remoteExecution: { stop: cleanupRemote },
    access: {
      require: async () => ({
        ...fixture.snapshot.plan,
        canEdit: true,
        projectName: "Synthetic project",
        github: null,
      }),
    },
    preparation: {
      prepare: async () => {
        throw new Error("No run is started by release");
      },
    },
    engine: {
      isActive: () => false,
      startRecovered: async () => {
        throw new Error("No run is started by release");
      },
    },
    planRuns: {
      latest: async () => run,
      hasReservation: async () => true,
      release,
    },
    executions,
    checkpoints: {
      list: async () => [],
      append: async () => {
        throw new Error("No checkpoint is written by release");
      },
    },
  });

  await expect(
    actions.release({
      userId: "owner",
      runId: "run",
      command: {
        action: "release",
        expectedRevision: 0,
        idempotencyKey: "cleanup-1",
      },
      requestDigest: "synthetic-digest",
    }),
  ).rejects.toMatchObject({ code: "cleanup_unconfirmed" });
  expect(cleanupRemote).toHaveBeenCalledWith(run);
  expect(record).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();

  storedRun = patchRecoveryStep(run, "b", {
    remote: {
      jobId: "723f9296-f849-4bdf-8193-f557fc819198",
      sessionId: "b23c35f9-d2c0-4ae6-9bca-de8d0ba14246",
      status: "failed",
      startedAt: null,
      endedAt: null,
      closeout: "confirmed",
    },
  });
  await expect(
    actions.release({
      userId: "owner",
      runId: "run",
      command: {
        action: "release",
        expectedRevision: 0,
        idempotencyKey: "cleanup-1",
      },
      requestDigest: "synthetic-digest",
    }),
  ).resolves.toMatchObject({ outcome: "released", revision: 1 });
  expect(record).toHaveBeenCalledOnce();
  expect(record.mock.calls[0]?.[1]).toEqual(storedRun);
  expect(cleanupRemote).toHaveBeenCalledOnce();
});

it("keeps reservations and newer run facts when the checked view changed before release commits", async () => {
  const fixture = await recoveryFixture();
  const database = new RecoveryDatabase(fixture.snapshot, fixture.failed);
  const executions = new AgentPlanRecoveryExecutionRepository(
    database.asDatabase(),
  );
  const before = database.run("run");
  const outdated = patchRecoveryStep(before, "b", {
    error: "older-error",
  });

  await expect(executions.recordAlone(RELEASE, outdated)).rejects.toMatchObject(
    {
      code: "revision_conflict",
    },
  );
  expect(database.run("run")).toEqual(before);
  expect(database.stored().locks.get("workspace")).toBe("run");
});

it("does not release before a restart when the checked run changed", async () => {
  const fixture = await recoveryFixture();
  const database = new RecoveryDatabase(fixture.snapshot, fixture.failed);
  const executions = new AgentPlanRecoveryExecutionRepository(
    database.asDatabase(),
  );
  const current = database.run("run");
  const outdated = patchRecoveryStep(current, "b", { error: "older-error" });

  await expect(executions.releaseChecked(outdated)).rejects.toMatchObject({
    code: "revision_conflict",
  });
  expect([...database.stored().locks.values()]).toContain("run");
  await executions.releaseChecked(current);
  expect([...database.stored().locks.values()]).not.toContain("run");
});

it.each(["pending", "failed"] as const)(
  "keeps a local reservation while session closeout is %s, even after an empty process scan",
  async (closeout) => {
    const fixture = await recoveryFixture();
    const session = fixture.failed.steps.find(
      (step) => step.id === "a",
    )?.session;
    if (!session) throw new Error("Synthetic session is missing");
    const run = patchRecoveryStep(fixture.failed, "a", {
      session: { ...session, closeout },
    });

    await expect(hasNoSessionProcesses(run)).resolves.toBe(false);
  },
);

it("accepts a session whose execution contract did not require closeout", async () => {
  const fixture = await recoveryFixture();
  const session = fixture.failed.steps.find((step) => step.id === "a")?.session;
  if (!session) throw new Error("Synthetic session is missing");
  const run = patchRecoveryStep(fixture.failed, "a", {
    session: { ...session, closeout: "not_needed" },
  });

  await expect(hasNoSessionProcesses(run)).resolves.toBe(true);
});
