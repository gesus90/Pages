import { randomUUID } from "node:crypto";

import { expect, it, vi } from "vitest";

import { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import { AgentPlanRecoveryRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryRepository";
import { AgentPlanRecoveryExecutionRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository";
import { emptyAgentPlan } from "@/definition/AgentPlan";

import { AgentError } from "@/backend/error/AgentErrors";

import { AgentPlanRecoveryActions } from "./AgentPlanRecoveryActions";
import { AgentPlanRecoveryService } from "./AgentPlanRecoveryService";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRun, AgentPlanView } from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "../AgentPlanSnapshot";

vi.mock("./AgentPlanRestartCleanup", () => ({
  cleanupRestartSource: vi.fn(async () => {}),
}));

const STOP_HERE = "Outside this test's execution boundary";

function executorRun(): AgentPlanRun {
  return {
    id: randomUUID(),
    planId: randomUUID(),
    planName: "Fixture",
    planRevision: 1,
    userId: "executor",
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "cancelled",
    stopRequested: true,
    steps: [],
  };
}

/** The plan as the other person sees it, with or without administrator rights. */
function planOf(run: AgentPlanRun, isAdministrator: boolean): AgentPlanView {
  return {
    ...emptyAgentPlan(),
    id: run.planId,
    ownerId: "owner",
    projectId: randomUUID(),
    revision: 1,
    canEdit: true,
    projectName: "Fixture",
    github: null,
    rights: {
      canRead: true,
      canEdit: true,
      canRun: true,
      canManageTeams: false,
      canChangeOwner: false,
      canDelete: false,
      isAdministrator,
      isAdminAccess: isAdministrator,
    },
  };
}

/** A run of "executor" that somebody else wants to restart; the plan view carries that person's rights. */
function setup(isAdministrator: boolean): {
  readonly actions: AgentPlanRecoveryActions;
  readonly service: AgentPlanRecoveryService;
  readonly run: AgentPlanRun;
  readonly prepare: ReturnType<typeof vi.fn>;
} {
  const run = executorRun();
  const plan = planOf(run, isAdministrator);
  const snapshot: AgentPlanSnapshot = { plan, steps: [] };
  const unavailable = async (): Promise<never> => {
    throw new Error(STOP_HERE);
  };
  const transaction: DatabaseTransaction = {
    execute: unavailable,
    query: async (statement) =>
      statement.includes("view_json")
        ? [[JSON.stringify(run), 3, JSON.stringify(snapshot)]]
        : [],
  };
  const database = {
    query: transaction.query,
    transaction: async <Result>(
      work: (connection: DatabaseTransaction) => Promise<Result>,
    ): Promise<Result> => work(transaction),
  };
  const prepare = vi.fn(unavailable);
  const execution = {
    access: { require: async () => plan },
    preparation: { prepare },
    engine: { startRecovered: unavailable, isActive: () => false },
    workspaceLocks: { release: unavailable },
    planRuns: {
      latest: async () => run,
      hasReservation: async () => false,
      release: unavailable,
    },
    executions: new AgentPlanRecoveryExecutionRepository(database),
  };
  const checkpoints = new AgentPlanCheckpointRepository(database);
  // Only an administrator controls a run of another executor, as in AgentPlanService.controlRun.
  const runs = {
    run: async () => run,
    readableRun: async () => ({
      run,
      startedBy: { id: run.userId, displayName: "Executor" },
      hiddenFields: ["prompt"],
      hiddenSources: [],
    }),
    controlRun: async () => {
      if (!isAdministrator) throw new AgentError("plan_access_denied");
      return run;
    },
  };
  const actions = new AgentPlanRecoveryActions({
    ...execution,
    runs,
    checkpoints,
  });
  const service = new AgentPlanRecoveryService({
    runs,
    recovery: new AgentPlanRecoveryRepository(database),
    checkpoints,
    execution,
  });
  return { actions, service, run, prepare };
}

function restart(
  actions: AgentPlanRecoveryActions,
  run: AgentPlanRun,
): Promise<unknown> {
  return actions.restart({
    userId: "someone-else",
    runId: run.id,
    requestDigest: "a".repeat(64),
    command: {
      action: "restart",
      idempotencyKey: "new-command",
      confirmRepeat: true,
    },
  });
}

it("lets an administrator restart a run of another executor", async () => {
  const { actions, run, prepare } = setup(true);
  await expect(restart(actions, run)).rejects.toThrow(STOP_HERE);
  expect(prepare).toHaveBeenCalledOnce();
});

it("refuses a restart of another executor's run without administrator rights", async () => {
  const { actions, run, prepare } = setup(false);
  await expect(restart(actions, run)).rejects.toMatchObject({
    code: "plan_access_denied",
  });
  expect(prepare).not.toHaveBeenCalled();
});

it("never lets an administrator resume the content of another executor's run", async () => {
  const { actions, run, prepare } = setup(true);
  await expect(
    actions.resume({
      userId: "someone-else",
      runId: run.id,
      requestDigest: "a".repeat(64),
      command: {
        action: "resume",
        idempotencyKey: "new-command",
        confirmContinue: true,
      },
    }),
  ).rejects.toMatchObject({ code: "access_denied" });
  expect(prepare).not.toHaveBeenCalled();
});

it("offers an administrator the restart, but never the resume, of another executor's run", async () => {
  const { service, run } = setup(true);
  const view = await service.view("someone-else", run.id);
  expect(view.restart.available).toBe(true);
  expect(view.resume.available).toBe(false);
});

it("offers nobody else a restart of another executor's run", async () => {
  const { service, run } = setup(false);
  const view = await service.view("someone-else", run.id);
  expect(view.restart.available).toBe(false);
});
