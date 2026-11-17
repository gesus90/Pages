import { randomUUID } from "node:crypto";

import { expect, it, vi } from "vitest";

import { retireRestartSource } from "./AgentPlanResourceReservation";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";

function runOf(
  planId: string,
  userId: string,
  status: AgentPlanRun["status"],
): AgentPlanRun {
  return {
    id: randomUUID(),
    planId,
    planName: "Fixture",
    planRevision: 1,
    userId,
    startedAt: "2026-01-01T00:00:00.000Z",
    status,
    stopRequested: false,
    steps: [],
  };
}

/** A restart that an administrator started: the new run belongs to the administrator. */
function restartOf(previous: AgentPlanRun, userId: string): AgentPlanRun {
  return {
    ...runOf(previous.planId, userId, "running"),
    origin: {
      kind: "restart",
      runId: previous.id,
      mode: null,
      checkpointVersion: null,
      reusedStepIds: [],
      retriedStepIds: [],
      reviewedStepIds: [],
      requestedAt: "2026-01-02T00:00:00.000Z",
    },
  };
}

function transactionOf(previous: AgentPlanRun): {
  readonly transaction: DatabaseTransaction;
  readonly execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => {});
  const transaction: DatabaseTransaction = {
    execute,
    query: async () => [[JSON.stringify(previous)]],
  };
  return { transaction, execute };
}

it("lets an administrator's restart pass the ended run of another executor", async () => {
  const previous = runOf(randomUUID(), "executor", "cancelled");
  const { transaction, execute } = transactionOf(previous);
  await expect(
    retireRestartSource(transaction, restartOf(previous, "administrator")),
  ).resolves.toBeUndefined();
  expect(execute).not.toHaveBeenCalled();
});

it("retires the open run of another executor for an administrator's restart", async () => {
  const previous = runOf(randomUUID(), "executor", "running");
  const { transaction, execute } = transactionOf(previous);
  await retireRestartSource(transaction, restartOf(previous, "administrator"));
  expect(execute).toHaveBeenCalledOnce();
});

it("refuses a restart that names a run of another plan", async () => {
  const previous = runOf(randomUUID(), "executor", "cancelled");
  const other = { ...restartOf(previous, "executor"), planId: randomUUID() };
  const { transaction } = transactionOf(previous);
  await expect(retireRestartSource(transaction, other)).rejects.toMatchObject({
    code: "plan_access_denied",
  });
});
