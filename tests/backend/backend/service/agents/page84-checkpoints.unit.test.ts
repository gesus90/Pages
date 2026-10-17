import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import {
  AgentPlanCheckpointRepository,
  MAXIMUM_PLAN_CHECKPOINT_BYTES,
} from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { createPlanCheckpoint } from "@/backend/service/agents/recovery/AgentPlanCheckpoint";

import { RecoveryDatabase } from "./page84-recovery-database";
import { patchRecoveryStep, recoveryFixture } from "./page84-recovery-fixture";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime("2026-10-17T01:00:00.000Z");
});
afterEach(() => {
  vi.useRealTimers();
});

it("commits A's completion and versioned checkpoint together, preserving frozen identity and separate assessments", async () => {
  const fixture = await recoveryFixture();
  const database = new RecoveryDatabase(fixture.snapshot, fixture.initial);
  const runs = new AgentPlanRunRepository(database.asDatabase());
  const checkpoints = new AgentPlanCheckpointRepository(database.asDatabase());
  const completion = createPlanCheckpoint(
    fixture.completed,
    fixture.snapshot,
    "a",
  );

  await runs.update(fixture.completed, completion);
  const saved = await checkpoints.find("run");

  expect(database.run("run").steps[0]).toMatchObject({
    status: "succeeded",
    output: "immutable A result",
  });
  expect(saved).toMatchObject({
    schemaVersion: 1,
    runId: "run",
    planId: "plan",
    planRevision: 1,
    version: 1,
    runRevision: 1,
    stepId: "a",
    completedStepIds: ["a"],
    pendingStepIds: ["b", "c"],
    workflow: { engine: "pages", runId: null },
  });
  expect(saved?.result).toMatchObject({
    technical: { resultCode: 0, closeout: "confirmed" },
    acceptance: { verdict: "accepted", summary: "A accepted" },
  });
  expect(saved?.session?.sessionId).toBe("original-native-session");
  expect(saved?.context.agentId).toBe("agent");
  expect(saved?.dispatchedPromptDigest).toMatch(/^[a-f0-9]{64}$/u);
});

it.each(["checkpoint", "progress"] as const)(
  "rolls back both completion and checkpoint on a %s storage fault",
  async (fault) => {
    const fixture = await recoveryFixture();
    const database = new RecoveryDatabase(fixture.snapshot, fixture.initial);
    const runs = new AgentPlanRunRepository(database.asDatabase());
    database.failNext(fault);

    await expect(
      runs.update(
        fixture.completed,
        createPlanCheckpoint(fixture.completed, fixture.snapshot, "a"),
      ),
    ).rejects.toThrow("storage fault");

    expect(database.run("run").steps[0].status).toBe("waiting");
    expect(database.stored().checkpoints).toEqual([]);
    expect(database.stored().runs.get("run")?.revision).toBe(0);
  },
);

it("deduplicates a repeated completion, retaining its original version, time, result and revision", async () => {
  const fixture = await recoveryFixture();
  const database = new RecoveryDatabase(fixture.snapshot, fixture.initial);
  const runs = new AgentPlanRunRepository(database.asDatabase());
  const completion = createPlanCheckpoint(
    fixture.completed,
    fixture.snapshot,
    "a",
  );
  await runs.update(fixture.completed, completion);
  const original = database.stored().checkpoints[0];

  await runs.update(fixture.completed, completion);

  expect(database.stored().checkpoints).toEqual([original]);
  const conflicting = {
    ...completion,
    completedAt: "2026-10-17T02:00:00.000Z",
  };
  await expect(
    runs.update(fixture.completed, conflicting),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });
  expect(database.stored().checkpoints).toEqual([original]);
});

it("requires a completion checkpoint and rejects a checkpoint for another frozen context", async () => {
  const fixture = await recoveryFixture();
  const database = new RecoveryDatabase(fixture.snapshot, fixture.initial);
  const runs = new AgentPlanRunRepository(database.asDatabase());

  await expect(runs.update(fixture.completed)).rejects.toMatchObject({
    code: "checkpoint_invalid",
  });
  const changed = {
    ...fixture.snapshot,
    plan: { ...fixture.snapshot.plan, revision: 2 },
  };
  await expect(
    runs.update(
      fixture.completed,
      createPlanCheckpoint(fixture.completed, changed, "a"),
    ),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });
  expect(database.stored().checkpoints).toHaveLength(0);
  expect(database.run("run").steps[0].status).toBe("waiting");
});

it("preserves A when B fails and refuses later replacement of A's result, acceptance or completion status", async () => {
  const fixture = await recoveryFixture();
  const database = new RecoveryDatabase(fixture.snapshot, fixture.initial);
  const runs = new AgentPlanRunRepository(database.asDatabase());
  await runs.update(
    fixture.completed,
    createPlanCheckpoint(fixture.completed, fixture.snapshot, "a"),
  );
  await runs.update(fixture.failed);
  const original = database.stored().checkpoints[0];

  await expect(
    runs.update(
      patchRecoveryStep(fixture.failed, "a", { output: "overwritten" }),
    ),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });
  await expect(
    runs.update(patchRecoveryStep(fixture.failed, "a", { status: "running" })),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });
  const session = fixture.completed.steps[0].session;
  if (!session) throw new Error("Missing synthetic completed session");
  await expect(
    runs.update(
      patchRecoveryStep(fixture.failed, "a", {
        session: { ...session, acceptance: null },
      }),
    ),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });

  expect(database.stored().checkpoints).toEqual([original]);
  expect(database.run("run").steps[2].status).toBe("waiting");
});

it("allocates later checkpoint versions without replacing earlier completion records", async () => {
  const fixture = await recoveryFixture();
  const database = new RecoveryDatabase(fixture.snapshot, fixture.initial);
  const runs = new AgentPlanRunRepository(database.asDatabase());
  const checkpoints = new AgentPlanCheckpointRepository(database.asDatabase());
  await runs.update(
    fixture.completed,
    createPlanCheckpoint(fixture.completed, fixture.snapshot, "a"),
  );
  const first = await checkpoints.find("run", 1);
  const secondRun = patchRecoveryStep(fixture.completed, "b", {
    status: "succeeded",
    output: "B result",
  });

  await runs.update(
    secondRun,
    createPlanCheckpoint(secondRun, fixture.snapshot, "b"),
  );

  expect(await checkpoints.find("run", 1)).toEqual(first);
  expect(await checkpoints.find("run")).toMatchObject({
    version: 2,
    stepId: "b",
    completedStepIds: ["a", "b"],
    dependencies: [{ stepId: "a", status: "succeeded" }],
  });
  expect(await checkpoints.find("run", 3)).toBeNull();
});

it("stores references and digests without copying original instructions, literal inputs or credentials", async () => {
  const fixture = await recoveryFixture();
  const source = fixture.snapshot.steps[0];
  const snapshot = {
    ...fixture.snapshot,
    steps: [
      {
        ...source,
        step: {
          ...source.step,
          bindings: {
            privateText: {
              kind: "literal" as const,
              value: {
                type: "text" as const,
                text: "Original sensitive input",
              },
            },
            previous: { kind: "result" as const, stepId: "prior" },
          },
        },
      },
      ...fixture.snapshot.steps.slice(1),
    ],
  };
  const run = patchRecoveryStep(fixture.completed, "a", {
    output: "password=synthetic-secret",
  });

  const checkpoint = createPlanCheckpoint(run, snapshot, "a");
  const serialized = JSON.stringify(checkpoint);

  expect(serialized).not.toContain("Original private assignment");
  expect(serialized).not.toContain("Original sensitive input");
  expect(serialized).not.toContain("synthetic-secret");
  expect(checkpoint.result.output).toBe("password=[redacted]");
  expect(checkpoint.inputs).toMatchObject([
    { name: "privateText", kind: "literal", reference: null },
    { name: "previous", kind: "result", reference: "prior" },
  ]);
});

it("rejects oversized checkpoint records before any durable insert", async () => {
  const fixture = await recoveryFixture();
  const database = new RecoveryDatabase(fixture.snapshot, fixture.initial);
  const checkpoints = new AgentPlanCheckpointRepository(database.asDatabase());
  const checkpoint = createPlanCheckpoint(
    fixture.completed,
    fixture.snapshot,
    "a",
  );
  const oversized = {
    ...checkpoint,
    result: {
      ...checkpoint.result,
      output: "x".repeat(MAXIMUM_PLAN_CHECKPOINT_BYTES),
    },
  };

  await expect(
    database
      .asDatabase()
      .transaction((transaction) =>
        checkpoints.append(transaction, oversized, 1),
      ),
  ).rejects.toMatchObject({ code: "checkpoint_too_large" });
  expect(database.stored().checkpoints).toHaveLength(0);
});

it("keeps legacy failed runs readable and terminal without synthesizing a checkpoint or a resume right", async () => {
  const fixture = await recoveryFixture();
  const legacy = { ...fixture.failed, recovery: undefined };
  const database = new RecoveryDatabase(fixture.snapshot, legacy);
  const runs = new AgentPlanRunRepository(database.asDatabase());

  expect(
    readPlanRun(JSON.parse(JSON.stringify(legacy))).recovery,
  ).toBeUndefined();
  expect((await runs.find("run"))?.status).toBe("failed");
  expect(
    await new AgentPlanCheckpointRepository(database.asDatabase()).find("run"),
  ).toBeNull();
  await expect(
    runs.update({ ...legacy, status: "running" }),
  ).rejects.toMatchObject({ code: "action_unavailable" });
});

it("omits inline binary assets from the checkpoint display copy while preserving the original result and digest", async () => {
  const fixture = await recoveryFixture();
  const original = "Result ![asset](data:image/png;base64,c3ludGhldGlj)";
  const completed = patchRecoveryStep(fixture.completed, "a", {
    output: original,
  });
  const database = new RecoveryDatabase(fixture.snapshot, fixture.initial);
  const runs = new AgentPlanRunRepository(database.asDatabase());
  const checkpoint = createPlanCheckpoint(completed, fixture.snapshot, "a");

  await runs.update(completed, checkpoint);

  expect(checkpoint.result.isOutputReduced).toBe(true);
  expect(checkpoint.result.output).not.toContain("c3ludGhldGlj");
  expect(checkpoint.result.output).toContain("[inline asset omitted]");
  expect(checkpoint.result.outputDigest).toBe(planContentDigest(original));
  expect(database.run("run").steps[0].output).toBe(original);
});

it("allows retained-session cleanup to settle but rejects replacement of its report, process ownership or model", async () => {
  const fixture = await recoveryFixture();
  const session = fixture.completed.steps[0].session;
  if (!session) throw new Error("Missing synthetic session");
  const retained = patchRecoveryStep(fixture.completed, "a", {
    session: {
      ...session,
      closeout: "pending",
      resultCode: null,
      endedAt: null,
    },
  });
  const database = new RecoveryDatabase(fixture.snapshot, fixture.initial);
  const runs = new AgentPlanRunRepository(database.asDatabase());
  await runs.update(
    retained,
    createPlanCheckpoint(retained, fixture.snapshot, "a"),
  );
  const original = database.stored().checkpoints;

  await runs.update(fixture.completed);

  expect(database.run("run").steps[0].session?.closeout).toBe("confirmed");
  expect(database.stored().checkpoints).toEqual(original);
  await expect(
    runs.update(
      patchRecoveryStep(fixture.completed, "a", {
        session: { ...session, instanceId: "foreign-instance" },
      }),
    ),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });
  await expect(
    runs.update(
      patchRecoveryStep(fixture.completed, "a", {
        session: {
          ...session,
          requested: { ...session.requested, model: "changed-model" },
        },
      }),
    ),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });
});
