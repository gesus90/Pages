import { expect, it, vi } from "vitest";

import { auditCleanupFailure } from "@/backend/service/agents/recovery/AgentPlanCleanupAudit";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { AgentPlanCleanupFailureRepository } from "@/backend/database/repositories/agent/AgentPlanCleanupFailureRepository";
import { readCleanupFailureRecord } from "@/backend/agents/AgentPlanCleanupFailureInput";
import { planRecoveryEntry } from "@/backend/service/agents/AgentPlanRecoveryViews";
import { translatePlanError } from "@/backend/service/agents/AgentPlanOperationErrors";

import { recoveryFixture } from "./page84-recovery-fixture";
import { recoveryWorld } from "./page171-recovery-world";

import type { AgentPlanCleanupFailureRecord } from "@/definition/AgentPlanCleanupResource";
import type { AgentPlanRecoveryCommand } from "@/definition/AgentPlanRecovery";
import type { Database } from "@/backend/database/Database";

const COMMAND: AgentPlanRecoveryCommand = {
  action: "release",
  expectedRevision: 0,
  idempotencyKey: "own-check",
};
const FAILURE = {
  stepId: "b",
  kind: "local_session",
  reason: "scan_access_denied",
} as const;

it("stores bounded original-run evidence and still refuses release", async () => {
  const fixture = await recoveryFixture();
  const append = vi.fn<AgentPlanCleanupFailureRepository["append"]>();
  const error = new AgentPlanRecoveryError("cleanup_unconfirmed", FAILURE);
  await expect(
    auditCleanupFailure({ append }, fixture.failed, COMMAND, error),
  ).rejects.toBe(error);
  expect(append).toHaveBeenCalledOnce();
  expect(append.mock.calls[0]?.[0]).toBe(fixture.failed.userId);
  const recorded = append.mock.calls[0]?.[1];
  expect(recorded).toMatchObject({
    ...FAILURE,
    action: "release",
    planId: fixture.failed.planId,
    runId: fixture.failed.id,
    planRevision: fixture.failed.planRevision,
    recoveryRevision: 0,
    attemptId: null,
  });
  expect(readCleanupFailureRecord(recorded)).toEqual(recorded);
  expect(JSON.stringify(recorded)).not.toContain("original-native-session");
});

it("reports audit storage failure without returning a release receipt", async () => {
  const fixture = await recoveryFixture();
  const append = vi.fn<AgentPlanCleanupFailureRepository["append"]>(
    async () => {
      throw new Error("Private storage error");
    },
  );
  await expect(
    auditCleanupFailure(
      { append },
      fixture.failed,
      COMMAND,
      new AgentPlanRecoveryError("cleanup_unconfirmed", FAILURE),
    ),
  ).rejects.toMatchObject({ code: "diagnostic_unavailable" });
  expect(
    translatePlanError(new AgentPlanRecoveryError("diagnostic_unavailable")),
  ).toMatchObject({
    details: { reason: "plan_recovery_diagnostic_unavailable" },
  });
});

it("does not invent diagnostic observations for authorization or revision refusals", async () => {
  const fixture = await recoveryFixture();
  const append = vi.fn<AgentPlanCleanupFailureRepository["append"]>();
  const error = new AgentPlanRecoveryError("revision_conflict");
  await expect(
    auditCleanupFailure({ append }, fixture.failed, COMMAND, error),
  ).rejects.toBe(error);
  expect(append).not.toHaveBeenCalled();
});

it("reads the stored failure through recovery and MCP without scanning or releasing", async () => {
  const fixture = await recoveryFixture();
  const entry: AgentPlanCleanupFailureRecord = {
    ...FAILURE,
    id: "8bdd546a-29f8-46de-a15a-66e7831423c6",
    createdAt: "2026-10-28T12:00:00.000Z",
    planId: fixture.failed.planId,
    runId: fixture.failed.id,
    planRevision: 1,
    recoveryRevision: 0,
    action: "release",
    attemptId: null,
  };
  const latest = vi.fn<AgentPlanCleanupFailureRepository["latest"]>(
    async () => entry,
  );
  const append = vi.fn<AgentPlanCleanupFailureRepository["append"]>();
  const world = recoveryWorld(fixture, fixture.failed, {
    cleanupFailures: { append, latest },
  });
  const original = world.database.run(fixture.failed.id);
  const view = await world.recovery.view(
    fixture.failed.userId,
    fixture.failed.id,
  );
  expect(view.latestCleanupFailure).toEqual(entry);
  expect(planRecoveryEntry(view, false).latestCleanupFailure).toEqual(entry);
  expect(latest).toHaveBeenCalledWith(fixture.failed.userId, fixture.failed.id);
  expect(world.database.run(fixture.failed.id)).toEqual(original);
  expect(append).not.toHaveBeenCalled();
  await expect(
    world.recovery.view("foreign", fixture.failed.id),
  ).rejects.toMatchObject({ code: "plan_access_denied" });
  expect(latest).toHaveBeenCalledTimes(1);
});

it("filters stored fields and scopes the repository read to the executor", async () => {
  const entry = {
    ...FAILURE,
    id: "8bdd546a-29f8-46de-a15a-66e7831423c6",
    createdAt: "2026-10-28T12:00:00.000Z",
    planId: "plan",
    runId: "run",
    planRevision: 1,
    recoveryRevision: 0,
    action: "release",
    attemptId: null,
  };
  const execute = vi.fn<Database["execute"]>();
  const query = vi.fn<Database["query"]>(async () => [
    [JSON.stringify({ ...entry, environment: "private" })],
  ]);
  const repository = new AgentPlanCleanupFailureRepository({ query, execute });
  await repository.append("owner", readCleanupFailureRecord(entry));
  expect(await repository.latest("owner", "run")).toEqual(entry);
  expect(query.mock.calls[0]?.[1]).toEqual({ run_id: "run", user_id: "owner" });
  expect(() =>
    readCleanupFailureRecord({ ...entry, reason: "private-error-text" }),
  ).toThrow();
  expect(() =>
    readCleanupFailureRecord({ ...entry, attemptId: "native-session" }),
  ).toThrow();
});

it("reports an unreadable cleanup audit without leaking its storage error", async () => {
  const fixture = await recoveryFixture();
  const latest = vi.fn<AgentPlanCleanupFailureRepository["latest"]>(
    async () => {
      throw new Error("Private storage error");
    },
  );
  const append = vi.fn<AgentPlanCleanupFailureRepository["append"]>();
  const world = recoveryWorld(fixture, fixture.failed, {
    cleanupFailures: { append, latest },
  });
  await expect(
    world.recovery.view(fixture.failed.userId, fixture.failed.id),
  ).rejects.toMatchObject({ code: "diagnostic_unavailable" });
  expect(world.start).not.toHaveBeenCalled();
  expect(append).not.toHaveBeenCalled();
});
