import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { readPlanCheckpoint } from "@/backend/service/agents/AgentPlanCheckpointRead";
import { createPlanCheckpoint } from "@/backend/service/agents/recovery/AgentPlanCheckpoint";

import { recoveryFixture } from "./page84-recovery-fixture";
import { recoveryWorld } from "./page171-recovery-world";
import { PlanWorld } from "./plan-operation-world";

import type { AgentPlanCheckpoint } from "@/definition/AgentPlanRecovery";

async function checkpointFixture(): Promise<AgentPlanCheckpoint> {
  const fixture = await recoveryFixture();
  return {
    ...createPlanCheckpoint(fixture.completed, fixture.snapshot, "a"),
    version: 1,
    runRevision: 2,
  };
}

it("reads an immutable checkpoint through the actual owner-checked recovery service", async () => {
  const fixture = await recoveryFixture();
  const world = recoveryWorld(fixture, fixture.initial);
  const runs = new AgentPlanRunRepository(world.database.asDatabase());
  await runs.update(
    fixture.completed,
    createPlanCheckpoint(fixture.completed, fixture.snapshot, "a"),
  );
  const result = await readPlanCheckpoint(
    world.plans,
    world.recovery,
    fixture.completed.userId,
    {
      planId: fixture.completed.planId,
      runId: fixture.completed.id,
      version: 1,
    },
  );

  if (!("checkpoint" in result) || !result.checkpoint)
    throw new Error("Expected a checkpoint");
  const content: unknown = JSON.parse(result.checkpoint.content);
  expect(result.checkpoint.version).toBe(1);
  expect(content).toMatchObject({
    planId: fixture.completed.planId,
    runId: fixture.completed.id,
    stepId: "a",
    result: { output: "immutable A result" },
  });
  expect(result.checkpoint.content).not.toContain("original-native-session");
  expect(result.checkpoint.content).not.toContain("owned-instance");
  await expect(
    readPlanCheckpoint(world.plans, world.recovery, "other", {
      planId: fixture.completed.planId,
      runId: fixture.completed.id,
    }),
  ).rejects.toMatchObject({ code: "plan_access_denied" });
});

it("masks historical credential-shaped text and marks the display output reduced", async () => {
  const fixture = await recoveryFixture();
  const checkpoint = await checkpointFixture();
  const unsafe = {
    ...checkpoint,
    result: { ...checkpoint.result, output: "password=synthetic-secret" },
  };
  const result = await readPlanCheckpoint(
    { run: async () => fixture.completed },
    { checkpoint: async () => unsafe },
    fixture.completed.userId,
    { planId: fixture.completed.planId, runId: fixture.completed.id },
  );

  if (!("checkpoint" in result) || !result.checkpoint)
    throw new Error("Expected a checkpoint");
  const content: unknown = JSON.parse(result.checkpoint.content);
  expect(result.checkpoint.isFiltered).toBe(true);
  expect(result.checkpoint.content).not.toContain("synthetic-secret");
  expect(content).toMatchObject({
    result: {
      isOutputReduced: true,
      outputDigest: checkpoint.result.outputDigest,
    },
  });
});

it("reassembles a large checkpoint with snapshot-bound UTF-8 chunks", async () => {
  const fixture = await recoveryFixture();
  const checkpoint = await checkpointFixture();
  const large = {
    ...checkpoint,
    result: { ...checkpoint.result, output: "ä".repeat(5_000) },
  };
  const plans = { run: async () => fixture.completed };
  let current = large;
  const recovery = { checkpoint: async () => current };
  const input = {
    planId: fixture.completed.planId,
    runId: fixture.completed.id,
    version: 1,
    maxBytes: 1024,
  };
  let cursor: string | null = null;
  let firstCursor: string | null = null;
  let text = "";
  let sha256 = "";
  do {
    const result = await readPlanCheckpoint(
      plans,
      recovery,
      fixture.completed.userId,
      {
        ...input,
        ...(cursor ? { cursor } : {}),
      },
    );
    if (!("chunk" in result)) throw new Error("Expected a chunk");
    expect(result.chunk.offsetBytes).toBe(Buffer.byteLength(text));
    text += result.chunk.text;
    sha256 = result.chunk.sha256;
    cursor = result.chunk.nextCursor;
    firstCursor ??= cursor;
  } while (cursor);
  expect(createHash("sha256").update(text).digest("hex")).toBe(sha256);
  expect(JSON.parse(text)).toMatchObject({ checkpoint: { version: 1 } });
  expect(firstCursor).not.toBeNull();
  current = { ...large, result: { ...large.result, output: "changed" } };
  await expect(
    readPlanCheckpoint(plans, recovery, fixture.completed.userId, {
      ...input,
      cursor: firstCursor,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});

it("refuses mismatched plans, inaccessible runs and invalid versions before reading a checkpoint", async () => {
  const fixture = await recoveryFixture();
  const checkpoint = vi.fn(async () => checkpointFixture());
  const recovery = { checkpoint };
  const run = vi.fn(async () => fixture.completed);
  await expect(
    readPlanCheckpoint({ run }, recovery, fixture.completed.userId, {
      planId: "another-plan",
      runId: fixture.completed.id,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    readPlanCheckpoint({ run }, recovery, fixture.completed.userId, {
      planId: fixture.completed.planId,
      runId: fixture.completed.id,
      version: 0,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  run.mockRejectedValueOnce(new AgentError("plan_access_denied"));
  await expect(
    readPlanCheckpoint({ run }, recovery, "other", {
      planId: fixture.completed.planId,
      runId: fixture.completed.id,
    }),
  ).rejects.toMatchObject({ code: "plan_access_denied" });
  expect(checkpoint).not.toHaveBeenCalled();
});

it.each(["plans.run.checkpoint.read", "plans.run.recovery.read"])(
  "withholds %s from run-scoped credentials even for direct operation calls",
  async (operation) => {
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
      world.operations.handle(identity, operation, {
        planId: "plan",
        runId: "run",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  },
);
