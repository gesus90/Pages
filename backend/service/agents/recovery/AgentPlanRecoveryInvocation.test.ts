import { randomUUID } from "node:crypto";

import { expect, it, vi } from "vitest";

import { AgentPlanRecoveryExecutionRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository";
import { emptyAgentPlan } from "@/definition/AgentPlan";

import { AgentPlanRecoveryActions } from "./AgentPlanRecoveryActions";
import { cleanupRestartSource } from "./AgentPlanRestartCleanup";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRun, AgentPlanView } from "@/definition/AgentPlan";
import type { AgentPlanRecoveryResult } from "@/definition/AgentPlanRecovery";
import type { AgentPlanSnapshot } from "../AgentPlanSnapshot";
import type { Mock } from "vitest";

vi.mock("./AgentPlanRestartCleanup", () => ({
  cleanupRestartSource: vi.fn(async () => {}),
}));

interface InvocationFixture {
  readonly run: AgentPlanRun;
  readonly plan: AgentPlanView;
  readonly snapshot: AgentPlanSnapshot;
  readonly continued: AgentPlanRecoveryResult | null;
}

interface RecoveryProbe {
  readonly actions: AgentPlanRecoveryActions;
  readonly prepare: Mock<() => Promise<never>>;
  readonly startRecovered: Mock<() => Promise<never>>;
}

function fixture(
  continued: AgentPlanRecoveryResult | null = null,
): InvocationFixture {
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
    id: run.planId,
    ownerId: run.userId,
    projectId: randomUUID(),
    revision: 2,
    canEdit: true,
    projectName: "Fixture",
    github: null,
  };
  const snapshot: AgentPlanSnapshot = {
    plan,
    steps: [],
    invocation: {
      id: randomUUID(),
      entryNodeId: "chosen-entry",
      sourcePlanId: randomUUID(),
      sourceRunId: randomUUID(),
      sourceNodeId: "caller",
      wait: "completion",
      inputs: { text: { type: "text", text: "preserved input" } },
      hasHandover: false,
    },
  };
  return { run, plan, snapshot, continued };
}

function recovery(facts: InvocationFixture): RecoveryProbe {
  const unavailable = async (): Promise<never> => {
    throw new Error("Outside this test's execution boundary");
  };
  const transaction: DatabaseTransaction = {
    execute: unavailable,
    query: async (statement) => {
      if (statement.includes("view_json"))
        return [
          [JSON.stringify(facts.run), 186, JSON.stringify(facts.snapshot)],
        ];
      if (facts.continued && statement.includes("target_run_id IS NOT NULL"))
        return [[JSON.stringify(facts.continued)]];
      return [];
    },
  };
  const database = {
    query: transaction.query,
    transaction: async <Result>(
      work: (connection: DatabaseTransaction) => Promise<Result>,
    ): Promise<Result> => work(transaction),
  };
  const prepare = vi.fn(unavailable);
  const startRecovered = vi.fn(unavailable);
  const actions = new AgentPlanRecoveryActions({
    runs: { run: async () => facts.run },
    access: { require: async () => facts.plan },
    preparation: { prepare },
    engine: { startRecovered, isActive: () => false },
    workspaceLocks: { release: unavailable },
    planRuns: {
      latest: async () => facts.run,
      hasReservation: async () => false,
      release: unavailable,
    },
    executions: new AgentPlanRecoveryExecutionRepository(database),
    checkpoints: { list: async () => [], append: unavailable },
  });
  return { actions, prepare, startRecovered };
}

function invoke(
  actions: AgentPlanRecoveryActions,
  action: "restart" | "resume",
  facts: InvocationFixture,
): Promise<AgentPlanRecoveryResult> {
  const request = {
    userId: facts.run.userId,
    runId: facts.run.id,
    requestDigest: "a".repeat(64),
  };
  if (action === "restart")
    return actions.restart({
      ...request,
      command: { action, idempotencyKey: "new-command", confirmRepeat: true },
    });
  return actions.resume({
    ...request,
    command: { action, idempotencyKey: "new-command", confirmContinue: true },
  });
}

it.each(["restart", "resume"] as const)(
  "preserves the chosen invocation entry and inputs when preparing %s from the current plan",
  async (action) => {
    const facts = fixture();
    const { actions, prepare, startRecovered } = recovery(facts);
    await expect(invoke(actions, action, facts)).rejects.toThrow(
      "Outside this test's execution boundary",
    );
    expect(prepare).toHaveBeenCalledExactlyOnceWith(
      facts.run.userId,
      facts.plan,
      facts.snapshot.invocation,
    );
    expect(startRecovered).not.toHaveBeenCalled();
  },
);

it.each(["restart", "resume"] as const)(
  "reuses a committed continuation before cleanup or preparation on %s",
  async (action) => {
    const continued: AgentPlanRecoveryResult = {
      commandId: randomUUID(),
      revision: 187,
      outcome: "started",
      runId: randomUUID(),
    };
    const facts = fixture(continued);
    const { actions, prepare, startRecovered } = recovery(facts);
    await expect(invoke(actions, action, facts)).resolves.toEqual(continued);
    expect(cleanupRestartSource).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(startRecovered).not.toHaveBeenCalled();
  },
);
