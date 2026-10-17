import { expect, it, vi } from "vitest";

import { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import { AgentPlanRecoveryRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { AgentError } from "@/backend/error/AgentErrors";
import { createPlanCheckpoint } from "@/backend/service/agents/recovery/AgentPlanCheckpoint";
import {
  classifyPlanFailure,
  planRecoveryReason,
} from "@/backend/service/agents/recovery/AgentPlanFailure";
import { AgentPlanRecoveryService } from "@/backend/service/agents/recovery/AgentPlanRecoveryService";

import { RecoveryDatabase } from "./page84-recovery-database";
import { patchRecoveryStep, recoveryFixture } from "./page84-recovery-fixture";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanRecoveryCommand } from "@/definition/AgentPlanRecovery";
import type { RecoveryFixture } from "./page84-recovery-fixture";

interface ControlWorld {
  readonly fixture: RecoveryFixture;
  readonly database: RecoveryDatabase;
  readonly service: AgentPlanRecoveryService;
  readonly access: {
    run(userId: string, runId: string): Promise<AgentPlanRun>;
  };
}

async function controlWorld(
  extraStep?: AgentPlanStepResult,
): Promise<ControlWorld> {
  const fixture = await recoveryFixture();
  const database = new RecoveryDatabase(fixture.snapshot, fixture.initial);
  const runs = new AgentPlanRunRepository(database.asDatabase());
  await runs.update(
    fixture.completed,
    createPlanCheckpoint(fixture.completed, fixture.snapshot, "a"),
  );
  await runs.update(
    extraStep
      ? { ...fixture.failed, steps: [...fixture.failed.steps, extraStep] }
      : fixture.failed,
  );
  const access = {
    run: async (userId: string, runId: string): Promise<AgentPlanRun> => {
      const run = database.run(runId);
      if (run.userId !== userId) throw new AgentError("plan_access_denied");
      return run;
    },
  };
  const service = new AgentPlanRecoveryService({
    runs: access,
    recovery: new AgentPlanRecoveryRepository(database.asDatabase()),
    checkpoints: new AgentPlanCheckpointRepository(database.asDatabase()),
  });
  return { fixture, database, service, access };
}

function repairCommand(
  revision: number,
  key = "repair-001",
): AgentPlanRecoveryCommand {
  return {
    action: "record_repair",
    expectedRevision: revision,
    idempotencyKey: key,
    stepId: "b",
    instruction: "Repair the failing test and report fresh evidence.",
  };
}

it("records B's repair separately without changing original inputs, A's success, native identity or C's eligibility", async () => {
  const world = await controlWorld();
  const before = world.database.stored();
  const originalSteps = world.database.run("run").steps;
  const view = await world.service.view("owner", "run");

  const result = await world.service.control(
    "owner",
    "run",
    repairCommand(view.revision),
  );
  const after = await world.service.view("owner", "run");

  expect(result).toMatchObject({
    revision: view.revision + 1,
    outcome: "recorded",
  });
  expect(after.attempts).toMatchObject([
    {
      action: "record_repair",
      stepId: "b",
      status: "recorded",
      text: "Repair the failing test and report fresh evidence.",
    },
  ]);
  expect(world.database.stored().runs.get("run")?.snapshot).toBe(
    before.runs.get("run")?.snapshot,
  );
  expect(world.database.run("run").steps).toEqual(originalSteps);
  expect(world.database.stored().checkpoints).toEqual(before.checkpoints);
  expect(after.allowedActions).not.toContain("resume");
});

it("deduplicates simultaneous and repeated control requests by the same key", async () => {
  const world = await controlWorld();
  const view = await world.service.view("owner", "run");
  const command = repairCommand(view.revision);

  const results = await Promise.all([
    world.service.control("owner", "run", command),
    world.service.control("owner", "run", command),
  ]);
  const repeated = await world.service.control("owner", "run", command);

  expect(results[0]).toEqual(results[1]);
  expect(repeated).toEqual(results[0]);
  expect(world.database.stored().attempts).toHaveLength(1);
  expect((await world.service.view("owner", "run")).revision).toBe(
    view.revision + 1,
  );
});

it("fences simultaneous different commands with one revision and rejects a changed payload under an existing key", async () => {
  const world = await controlWorld();
  const view = await world.service.view("owner", "run");
  const outcomes = await Promise.allSettled([
    world.service.control("owner", "run", repairCommand(view.revision)),
    world.service.control(
      "owner",
      "run",
      repairCommand(view.revision, "repair-002"),
    ),
  ]);

  expect(outcomes.map((outcome) => outcome.status)).toEqual([
    "fulfilled",
    "rejected",
  ]);
  expect(outcomes[1]).toMatchObject({ reason: { code: "revision_conflict" } });
  await expect(
    world.service.control("owner", "run", {
      ...repairCommand(view.revision),
      instruction: "Different repair",
    }),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
  expect(world.database.stored().attempts).toHaveLength(1);
});

it.each(["attempt", "progress"] as const)(
  "rolls back the audit and revision when %s persistence fails",
  async (fault) => {
    const world = await controlWorld();
    const view = await world.service.view("owner", "run");
    world.database.failNext(fault);

    await expect(
      world.service.control("owner", "run", repairCommand(view.revision)),
    ).rejects.toThrow("storage fault");
    expect(world.database.stored().attempts).toHaveLength(0);
    expect((await world.service.view("owner", "run")).revision).toBe(
      view.revision,
    );
  },
);

it("makes cancel terminal and idempotent and refuses every later recovery mode", async () => {
  const world = await controlWorld();
  const before = await world.service.view("owner", "run");
  const cancel: AgentPlanRecoveryCommand = {
    action: "cancel",
    expectedRevision: before.revision,
    idempotencyKey: "cancel-001",
  };

  const result = await world.service.control("owner", "run", cancel);
  expect(await world.service.control("owner", "run", cancel)).toEqual(result);
  const view = await world.service.view("owner", "run");
  expect(view.state).toBe("cancelled");
  expect(view.allowedActions).toEqual([]);
  expect(world.database.run("run").steps[0].output).toBe("immutable A result");
  for (const mode of ["live", "native_resume", "new_session"] as const)
    await expect(
      world.service.control("owner", "run", {
        action: "resume",
        mode,
        expectedRevision: view.revision,
        idempotencyKey: `resume-${mode}`,
      }),
    ).rejects.toMatchObject({ code: "action_unavailable" });
  await expect(
    world.service.control(
      "owner",
      "run",
      repairCommand(view.revision, "repair-later"),
    ),
  ).rejects.toMatchObject({ code: "action_unavailable" });
});

it("requires a real workflow restore path even after explicit effects review and session-mode selection", async () => {
  const world = await controlWorld();
  const initial = await world.service.view("owner", "run");
  expect(initial.nodes.find((node) => node.stepId === "b")?.sideEffects).toBe(
    "unknown",
  );
  await world.service.control("owner", "run", {
    action: "reconcile",
    stepId: "b",
    decision: "effects_reviewed",
    note: "Reviewed workspace and ticket writes; no replay is authorized.",
    expectedRevision: initial.revision,
    idempotencyKey: "review-001",
  });
  const reviewed = await world.service.view("owner", "run");

  expect(reviewed.nodes.find((node) => node.stepId === "b")?.sideEffects).toBe(
    "reviewed",
  );
  expect(reviewed.blockers).toEqual([
    "workflow_unavailable",
    "context_not_verified",
  ]);
  for (const mode of ["live", "native_resume", "new_session"] as const)
    await expect(
      world.service.control("owner", "run", {
        action: "resume",
        mode,
        expectedRevision: reviewed.revision,
        idempotencyKey: `resume-${mode}`,
      }),
    ).rejects.toMatchObject({ code: "workflow_unavailable" });
  expect(world.database.stored().attempts).toHaveLength(1);
  expect(world.database.run("run").steps[2].status).toBe("waiting");
});

it("never grants another user access or offers repair of an already successful node", async () => {
  const world = await controlWorld();
  const view = await world.service.view("owner", "run");

  await expect(world.service.view("other", "run")).rejects.toMatchObject({
    code: "plan_access_denied",
  });
  await expect(
    world.service.checkpoint("other", "run", 1),
  ).rejects.toMatchObject({ code: "plan_access_denied" });
  await expect(
    world.service.control("other", "run", repairCommand(view.revision)),
  ).rejects.toMatchObject({ code: "plan_access_denied" });
  await expect(
    world.service.control("owner", "run", {
      ...repairCommand(view.revision),
      stepId: "a",
    }),
  ).rejects.toMatchObject({ code: "action_unavailable" });
  expect(world.database.stored().attempts).toHaveLength(0);
});

it("rechecks current rights for reads and commands after earlier access was granted", async () => {
  const world = await controlWorld();
  const view = await world.service.view("owner", "run");
  vi.spyOn(world.access, "run").mockRejectedValue(
    new AgentError("plan_access_denied"),
  );

  await expect(world.service.view("owner", "run")).rejects.toMatchObject({
    code: "plan_access_denied",
  });
  await expect(
    world.service.checkpoint("owner", "run", 1),
  ).rejects.toMatchObject({ code: "plan_access_denied" });
  await expect(
    world.service.control("owner", "run", repairCommand(view.revision)),
  ).rejects.toMatchObject({ code: "plan_access_denied" });
  expect(world.database.stored().attempts).toHaveLength(0);
});

it("redacts instructions and reconciliation notes and refuses missing revisions, keys and unknown control fields", async () => {
  const world = await controlWorld();
  const view = await world.service.view("owner", "run");
  await world.service.control("owner", "run", {
    ...repairCommand(view.revision),
    instruction: "password=synthetic-secret",
  });
  const saved = await world.service.view("owner", "run");

  expect(saved.attempts[0].text).toBe("[redacted]");
  await expect(
    world.service.control("owner", "run", {
      ...repairCommand(view.revision),
      instruction: "password=different-synthetic-secret",
    }),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
  expect(JSON.stringify(world.database.stored().attempts)).not.toContain(
    "synthetic-secret",
  );
  for (const input of [
    { action: "cancel" },
    {
      action: "cancel",
      expectedRevision: saved.revision,
      idempotencyKey: "short",
    },
    { ...repairCommand(saved.revision), provider: "other" },
  ])
    await expect(
      world.service.control("owner", "run", input),
    ).rejects.toMatchObject({ code: "invalid_request" });
});

it("keeps old terminal failures closed even when their error now has a recoverable classification", async () => {
  const fixture = await recoveryFixture();
  const legacy = { ...fixture.failed, recovery: undefined };
  const database = new RecoveryDatabase(fixture.snapshot, legacy);
  const recovery = new AgentPlanRecoveryRepository(database.asDatabase());

  await expect(
    recovery.control("owner", "run", repairCommand(0)),
  ).rejects.toMatchObject({ code: "action_unavailable" });
  expect(database.stored().attempts).toHaveLength(0);
});

it.each([
  ["provider_unreachable", "provider"],
  ["plan_runner_permission_denied", "approval"],
  ["plan_group_acceptance_failed", "business"],
  ["plan_context_changed", "configuration"],
  ["timeout", "timeout"],
  ["plan_interrupted", "interruption"],
  ["plan_closeout_failed", "cleanup"],
  ["plan_step_failed", "terminal"],
  ["toString", "terminal"],
  ["__proto__", "terminal"],
] as const)(
  "classifies %s separately as %s and never overrides an explicit stop",
  async (error, classification) => {
    const fixture = await recoveryFixture();
    const run = patchRecoveryStep(fixture.failed, "b", { error });
    expect(classifyPlanFailure(run.steps[1])).toBe(classification);
    expect(planRecoveryReason({ ...run, stopRequested: true })).toBeUndefined();
    expect(planRecoveryReason(run)?.state).toBe(
      classification === "terminal" ? undefined : "recoverable",
    );
  },
);

it("rejects repair and reconciliation targets that are group summaries rather than frozen agent steps", async () => {
  const world = await controlWorld({
    id: "outer-group",
    name: "Group summary",
    status: "failed",
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: "plan_group_acceptance_failed",
  });
  const view = await world.service.view("owner", "run");

  expect(view.nodes.find((node) => node.stepId === "b")?.canRecordRepair).toBe(
    true,
  );
  expect(
    view.nodes.find((node) => node.stepId === "outer-group")?.canRecordRepair,
  ).toBe(false);
  await expect(
    world.service.control("owner", "run", {
      ...repairCommand(view.revision),
      stepId: "outer-group",
    }),
  ).rejects.toMatchObject({ code: "action_unavailable" });
  await expect(
    world.service.control("owner", "run", {
      action: "reconcile",
      stepId: "outer-group",
      decision: "effects_reviewed",
      note: "Review",
      expectedRevision: view.revision,
      idempotencyKey: "group-review",
    }),
  ).rejects.toMatchObject({ code: "action_unavailable" });
  expect(world.database.stored().attempts).toHaveLength(0);
});
