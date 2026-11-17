import { randomUUID } from "node:crypto";

import { expect, it, vi } from "vitest";

import { AgentPlanRecoveryExecutionRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository";
import { emptyAgentPlan } from "@/definition/AgentPlan";

import { AgentPlanRecoveryActions } from "./AgentPlanRecoveryActions";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRun, AgentPlanView } from "@/definition/AgentPlan";

vi.mock("../AgentPlanRecovery", () => ({
  checkSessionProcesses: async () => ({ confirmed: false }),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  readScopeSince: async () => ({ earliestStart: 0 }),
}));

it("keeps cleanup failure blocking resume before any workspace release or dispatch", async () => {
  const run: AgentPlanRun = {
    id: randomUUID(),
    planId: randomUUID(),
    planName: "Fixture",
    planRevision: 1,
    userId: "executor",
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "failed",
    stopRequested: false,
    steps: [],
  };
  const plan: AgentPlanView = {
    ...emptyAgentPlan(),
    name: "Fixture",
    id: run.planId,
    ownerId: run.userId,
    projectId: randomUUID(),
    revision: 1,
    canEdit: true,
    projectName: "Fixture",
    github: null,
  };
  const basis = { plan, steps: [] };
  const write = vi.fn(async () => {});
  const transaction: DatabaseTransaction = {
    execute: write,
    query: async (statement) =>
      statement.includes("view_json")
        ? [[JSON.stringify(run), 186, JSON.stringify(basis)]]
        : [],
  };
  const database = {
    query: transaction.query,
    transaction: async <Result>(
      work: (connection: DatabaseTransaction) => Promise<Result>,
    ): Promise<Result> => work(transaction),
  };
  const startRecovered = vi.fn(async () => {
    throw new Error("Must not dispatch");
  });
  const release = vi.fn(async () => {
    throw new Error("Must not release");
  });
  const actions = new AgentPlanRecoveryActions({
    workspaceLocks: { release },
    runs: { run: async () => run },
    access: { require: async () => plan },
    preparation: { prepare: async () => basis },
    engine: { startRecovered, isActive: () => false },
    planRuns: {
      latest: async () => run,
      hasReservation: async () => true,
      release: async () => {
        throw new Error("Must not release");
      },
    },
    executions: new AgentPlanRecoveryExecutionRepository(database),
    checkpoints: {
      list: async () => [],
      append: async () => {
        throw new Error("Must not checkpoint");
      },
    },
  });
  await expect(
    actions.resume({
      userId: run.userId,
      runId: run.id,
      command: {
        action: "resume",
        confirmContinue: true,
        idempotencyKey: "resume-fixture",
      },
      requestDigest: "a".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "cleanup_unconfirmed" });
  expect(startRecovered).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});
