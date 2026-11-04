import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import { AgentPlanCleanupFailureRepository } from "@/backend/database/repositories/agent/AgentPlanCleanupFailureRepository";
import { AgentPlanLoopIterationRepository } from "@/backend/database/repositories/agent/AgentPlanLoopIterationRepository";
import { AgentPlanRecoveryExecutionRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository";
import { AgentPlanRecoveryRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryRepository";
import { AgentPlanRepository } from "@/backend/database/repositories/agent/AgentPlanRepository";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";

import {
  callAtAnyTime,
  checkpointFixture,
  DIGEST,
  OTHER_DIGEST,
  OTHER_USER,
  OWNER,
  planFixture,
  runFixture,
  snapshotFixture,
  stepFixture,
} from "./plan-fixtures";
import { call, prepare, refused, reversedInPostgres, stored } from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type { RecoveryExecutionWrite } from "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanCleanupFailureRecord } from "@/definition/AgentPlanCleanupResource";
import type { AgentPlanLoopIterationCheckpoint } from "@/definition/AgentPlanLoopRun";
import type { AgentPlanRecoveryCommand } from "@/definition/AgentPlanRecovery";

const PLAN = planFixture("plan-recovery", { name: "Wiederaufnahme" });
const SNAPSHOT = snapshotFixture(PLAN);
const COMPLETED = runFixture("run-checkpoint", PLAN.id, {
  steps: [stepFixture("review", { status: "succeeded", output: "done" })],
});
const FAILED_RUN: AgentPlanRun = runFixture("run-recovery", PLAN.id, {
  status: "failed",
  recovery: { state: "recoverable", requiresReconciliation: true },
  steps: [
    stepFixture("review", { status: "failed", error: "plan_step_failed" }),
  ],
});
const STOPPED_RUN = runFixture("run-released", PLAN.id, {
  status: "stopping",
  stopRequested: true,
  steps: [stepFixture("review", { status: "running" })],
});
const ITERATION: AgentPlanLoopIterationCheckpoint = {
  schemaVersion: 1,
  runId: "run-loop",
  loopId: "loop-1",
  iteration: 1,
  completedAt: "2026-03-01T08:00:00.000Z",
  count: {
    source: "value",
    parameterId: null,
    effective: 3,
    mode: "max",
  },
  condition: { state: "not_evaluated", reason: "disabled" },
  nodes: [],
};
const CLEANUP_FAILURE: AgentPlanCleanupFailureRecord = {
  id: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-03-01T08:00:00.000Z",
  planId: PLAN.id,
  runId: "run-cleanup",
  planRevision: 1,
  recoveryRevision: 0,
  action: "release",
  attemptId: null,
  stepId: "review",
  kind: "local_session",
  reason: "processes_remaining",
};

function executionWrite(
  runId: string,
  key: string,
  revision: number,
  action: "restart" | "resume" | "release",
): RecoveryExecutionWrite {
  return {
    command: {
      expectedRevision: revision - 1,
      idempotencyKey: key,
      action: "release",
    },
    requestDigest: planContentDigest(key),
    execution: {
      id: `execution-${key}`,
      runId,
      userId: OWNER,
      action,
      targetRunId: null,
      origin: null,
      revision,
      createdAt: "2026-03-01T08:00:00.000Z",
    },
    result: { commandId: `command-${key}`, revision, outcome: "released" },
  };
}

function checkpoints({
  database,
}: RepositoryWorld): AgentPlanCheckpointRepository {
  return new AgentPlanCheckpointRepository(database);
}

function executions({
  database,
}: RepositoryWorld): AgentPlanRecoveryExecutionRepository {
  return new AgentPlanRecoveryExecutionRepository(database);
}

function recovery({ database }: RepositoryWorld): AgentPlanRecoveryRepository {
  return new AgentPlanRecoveryRepository(database);
}

async function insertRun(
  { database }: RepositoryWorld,
  run: AgentPlanRun,
): Promise<void> {
  await new AgentPlanRunRepository(database).create(run, SNAPSHOT, []);
}

const REPAIR_COMMAND: AgentPlanRecoveryCommand = {
  expectedRevision: 0,
  idempotencyKey: "repair-key-1",
  action: "record_repair",
  stepId: "review",
  instruction: "Bitte wiederholen",
};

/** Completions of a node, versioned per run. */
export const CHECKPOINT_FLOW: RepositoryFlow = {
  title: "plan checkpoints",
  steps: [
    call("AgentPlanRepository.save", ({ database }) =>
      new AgentPlanRepository(database).save(PLAN, true),
    ),
    call("AgentPlanCheckpointRepository.find", (world) =>
      checkpoints(world).find("run-checkpoint"),
    ),
    call("AgentPlanCheckpointRepository.list", (world) =>
      checkpoints(world).list("run-checkpoint"),
    ),
    call("AgentPlanCheckpointRepository.append", (world) =>
      world.database.transaction((transaction) =>
        checkpoints(world).append(
          transaction,
          checkpointFixture(COMPLETED, SNAPSHOT),
          4,
        ),
      ),
    ),
    call("AgentPlanCheckpointRepository.append", (world) =>
      world.database.transaction((transaction) =>
        checkpoints(world).append(
          transaction,
          checkpointFixture(COMPLETED, SNAPSHOT),
          5,
        ),
      ),
    ),
    call("AgentPlanCheckpointRepository.append", (world) =>
      world.database.transaction((transaction) =>
        checkpoints(world).append(
          transaction,
          { ...checkpointFixture(COMPLETED, SNAPSHOT), stepId: "second" },
          6,
        ),
      ),
    ),
    refused("AgentPlanCheckpointRepository.append", (world) =>
      world.database.transaction((transaction) =>
        checkpoints(world).append(
          transaction,
          {
            ...checkpointFixture(COMPLETED, SNAPSHOT),
            workspaceDigest: DIGEST,
          },
          7,
        ),
      ),
    ),
    reversedInPostgres("agent_plan_checkpoints"),
    call("AgentPlanCheckpointRepository.find", (world) =>
      checkpoints(world).find("run-checkpoint"),
    ),
    call("AgentPlanCheckpointRepository.find", (world) =>
      checkpoints(world).find("run-checkpoint", 1),
    ),
    call("AgentPlanCheckpointRepository.find", (world) =>
      checkpoints(world).find("run-checkpoint", 9),
    ),
    call("AgentPlanCheckpointRepository.find", (world) =>
      checkpoints(world).find("run-checkpoint", 2_147_483_648),
    ),
    call("AgentPlanCheckpointRepository.list", (world) =>
      checkpoints(world).list("run-checkpoint"),
    ),
  ],
};

/** Failed cleanups of a run, per executor. */
export const CLEANUP_FAILURE_FLOW: RepositoryFlow = {
  title: "plan cleanup failures",
  steps: [
    call("AgentPlanCleanupFailureRepository.latest", ({ database }) =>
      new AgentPlanCleanupFailureRepository(database).latest(
        OWNER,
        "run-cleanup",
      ),
    ),
    call("AgentPlanCleanupFailureRepository.append", ({ database }) =>
      new AgentPlanCleanupFailureRepository(database).append(
        OWNER,
        CLEANUP_FAILURE,
      ),
    ),
    call("AgentPlanCleanupFailureRepository.append", ({ database }) =>
      new AgentPlanCleanupFailureRepository(database).append(OWNER, {
        ...CLEANUP_FAILURE,
        id: "33333333-3333-4333-8333-333333333333",
        stepId: "later",
      }),
    ),
    reversedInPostgres("agent_plan_cleanup_failures"),
    call("AgentPlanCleanupFailureRepository.latest", ({ database }) =>
      new AgentPlanCleanupFailureRepository(database).latest(
        OWNER,
        "run-cleanup",
      ),
    ),
    call("AgentPlanCleanupFailureRepository.latest", ({ database }) =>
      new AgentPlanCleanupFailureRepository(database).latest(
        OTHER_USER,
        "run-cleanup",
      ),
    ),
    refused("AgentPlanCleanupFailureRepository.append", ({ database }) =>
      new AgentPlanCleanupFailureRepository(database).append(
        OWNER,
        CLEANUP_FAILURE,
      ),
    ),
  ],
};

/** A completed iteration of a loop, stored once. */
export const LOOP_ITERATION_FLOW: RepositoryFlow = {
  title: "plan loop iterations",
  steps: [
    call("AgentPlanLoopIterationRepository.append", ({ database }) =>
      database.transaction((transaction) =>
        new AgentPlanLoopIterationRepository().append(
          transaction,
          ITERATION,
          1,
        ),
      ),
    ),
    call("AgentPlanLoopIterationRepository.append", ({ database }) =>
      database.transaction((transaction) =>
        new AgentPlanLoopIterationRepository().append(
          transaction,
          ITERATION,
          2,
        ),
      ),
    ),
    call("AgentPlanLoopIterationRepository.append", ({ database }) =>
      database.transaction((transaction) =>
        new AgentPlanLoopIterationRepository().append(
          transaction,
          {
            ...ITERATION,
            iteration: 2,
            count: { ...ITERATION.count, source: "stack", mode: "expected" },
            condition: {
              state: "evaluated",
              isMet: true,
              found: { type: "object" },
            },
          },
          3,
        ),
      ),
    ),
    stored(`
      SELECT iteration, run_revision, count_source, count_mode, effective_count, condition_state, condition_met
      FROM agent_plan_loop_iterations
      WHERE run_id = 'run-loop'
      ORDER BY iteration;
    `),
    refused("AgentPlanLoopIterationRepository.append", ({ database }) =>
      database.transaction((transaction) =>
        new AgentPlanLoopIterationRepository().append(
          transaction,
          { ...ITERATION, completedAt: "2026-03-02T08:00:00.000Z" },
          3,
        ),
      ),
    ),
    refused("AgentPlanLoopIterationRepository.append", ({ database }) =>
      database.transaction((transaction) =>
        new AgentPlanLoopIterationRepository().append(
          transaction,
          { ...ITERATION, iteration: 0 },
          3,
        ),
      ),
    ),
  ],
};

/** Decisions that restart, resume or release a run. */
export const RECOVERY_EXECUTION_FLOW: RepositoryFlow = {
  title: "plan recovery executions",
  steps: [
    refused("AgentPlanRecoveryExecutionRepository.source", (world) =>
      executions(world).source("run-missing"),
    ),
    call("AgentPlanRunRepository.create", (world) =>
      insertRun(
        world,
        runFixture("run-execution", PLAN.id, { status: "failed" }),
      ),
    ),
    call("AgentPlanRecoveryExecutionRepository.source", (world) =>
      executions(world).source("run-execution"),
    ),
    call("AgentPlanRecoveryExecutionRepository.list", (world) =>
      executions(world).list("run-execution"),
    ),
    call("AgentPlanRecoveryExecutionRepository.replay", (world) =>
      executions(world).replay(
        "run-execution",
        executionWrite("run-execution", "execution-1", 1, "release").command,
        OTHER_DIGEST,
      ),
    ),
    call("AgentPlanRecoveryExecutionRepository.record", (world) =>
      world.database.transaction((transaction) =>
        executions(world).record(
          transaction,
          executionWrite("run-execution", "execution-1", 1, "resume"),
        ),
      ),
    ),
    refused("AgentPlanRecoveryExecutionRepository.record", (world) =>
      world.database.transaction((transaction) =>
        executions(world).record(
          transaction,
          executionWrite("run-execution", "execution-9", 9, "resume"),
        ),
      ),
    ),
    call("AgentPlanRecoveryExecutionRepository.replay", (world) =>
      executions(world).replay(
        "run-execution",
        executionWrite("run-execution", "execution-1", 1, "release").command,
        planContentDigest("execution-1"),
      ),
    ),
    call("AgentPlanRecoveryExecutionRepository.replay", (world) =>
      world.database.transaction((transaction) =>
        executions(world).replay(
          "run-execution",
          executionWrite("run-execution", "execution-1", 1, "release").command,
          planContentDigest("execution-1"),
          transaction,
        ),
      ),
    ),
    refused("AgentPlanRecoveryExecutionRepository.replay", (world) =>
      executions(world).replay(
        "run-execution",
        executionWrite("run-execution", "execution-1", 1, "release").command,
        OTHER_DIGEST,
      ),
    ),
    prepare(`
      INSERT INTO agent_plan_recovery_executions (id, run_id, user_id, action, idempotency_key, request_digest, expected_revision, result_revision, execution_json, result_json)
      SELECT
          'z-execution-' || CAST(number AS TEXT),
          run_id,
          user_id,
          action,
          'same-revision-' || CAST(number AS TEXT),
          request_digest,
          expected_revision,
          result_revision,
          replace(execution_json, 'execution-execution-1', 'z-execution-' || CAST(number AS TEXT)),
          result_json
      FROM agent_plan_recovery_executions, generate_series(1, 9) AS numbers(number)
      WHERE id = 'execution-execution-1';
    `),
    // An index read backwards undoes a reversed table, so both physical orders are read.
    call("AgentPlanRecoveryExecutionRepository.list", (world) =>
      executions(world).list("run-execution"),
    ),
    reversedInPostgres("agent_plan_recovery_executions"),
    stored(
      "SELECT id FROM agent_plan_recovery_executions WHERE run_id = 'run-execution' ORDER BY result_revision DESC, id DESC;",
    ),
    call("AgentPlanRecoveryExecutionRepository.list", (world) =>
      executions(world).list("run-execution"),
    ),
    call("AgentPlanRecoveryExecutionRepository.recordReset", async (world) =>
      executions(world).recordReset(
        executionWrite("run-execution", "execution-2", 2, "restart"),
        (await executions(world).source("run-execution")).run,
      ),
    ),
    stored(
      "SELECT status, recovery_revision FROM agent_plan_runs WHERE id = 'run-execution';",
    ),
    stored(
      "SELECT workspace_id, run_id, state FROM agent_workspace_cleanup WHERE run_id = 'run-execution';",
    ),
    refused("AgentPlanRecoveryExecutionRepository.releaseChecked", (world) =>
      executions(world).releaseChecked(
        runFixture("run-execution", PLAN.id, { status: "running" }),
      ),
    ),
    refused("AgentPlanRecoveryExecutionRepository.releaseChecked", (world) =>
      executions(world).releaseChecked(
        runFixture("run-execution", PLAN.id, {
          status: "failed",
          planName: "Anders",
        }),
      ),
    ),
    prepare(`
      INSERT INTO agent_plan_workspace_locks (workspace_id, run_id)
      VALUES ('released-a', 'run-execution'), ('released-b', 'run-execution');
    `),
    call("AgentPlanRecoveryExecutionRepository.releaseChecked", async (world) =>
      executions(world).releaseChecked(
        (await executions(world).source("run-execution")).run,
      ),
    ),
    stored(
      "SELECT COUNT(*) FROM agent_plan_workspace_locks WHERE run_id = 'run-execution';",
    ),
    call("AgentPlanRecoveryExecutionRepository.recordAlone", (world) =>
      executions(world).recordAlone(
        executionWrite("run-execution", "execution-3", 3, "release"),
      ),
    ),
    call("AgentPlanRunRepository.create", (world) =>
      insertRun(world, STOPPED_RUN),
    ),
    prepare(`
      INSERT INTO agent_plan_workspace_locks (workspace_id, run_id)
      VALUES ('released-c', 'run-released');
    `),
    refused("AgentPlanRecoveryExecutionRepository.recordAlone", (world) =>
      executions(world).recordAlone(
        executionWrite("run-released", "execution-4", 1, "release"),
        { ...STOPPED_RUN, planName: "Anders" },
      ),
    ),
    call("AgentPlanRecoveryExecutionRepository.recordAlone", async (world) =>
      executions(world).recordAlone(
        executionWrite("run-released", "execution-4", 1, "release"),
        (await executions(world).source("run-released")).run,
      ),
    ),
    callAtAnyTime("AgentPlanRecoveryExecutionRepository.source", (world) =>
      executions(world).source("run-released"),
    ),
    stored(
      "SELECT COUNT(*) FROM agent_plan_workspace_locks WHERE run_id = 'run-released';",
    ),
  ],
};

/** The preparations and the cancellation of a disturbed run. */
export const RECOVERY_FLOW: RepositoryFlow = {
  title: "plan recovery",
  steps: [
    refused("AgentPlanRecoveryRepository.inspect", (world) =>
      recovery(world).inspect("run-missing"),
    ),
    call("AgentPlanRunRepository.create", (world) =>
      insertRun(world, FAILED_RUN),
    ),
    call("AgentPlanRecoveryRepository.inspect", (world) =>
      recovery(world).inspect("run-recovery"),
    ),
    refused("AgentPlanRecoveryRepository.control", (world) =>
      recovery(world).control(OTHER_USER, "run-recovery", REPAIR_COMMAND),
    ),
    refused("AgentPlanRecoveryRepository.control", (world) =>
      recovery(world).control(OWNER, "run-recovery", {
        ...REPAIR_COMMAND,
        expectedRevision: 5,
      }),
    ),
    call("AgentPlanRecoveryRepository.control", async (world) => {
      const result = await recovery(world).control(
        OWNER,
        "run-recovery",
        REPAIR_COMMAND,
      );
      return { revision: result.revision, outcome: result.outcome };
    }),
    call("AgentPlanRecoveryRepository.control", async (world) => {
      const result = await recovery(world).control(
        OWNER,
        "run-recovery",
        REPAIR_COMMAND,
      );
      return { revision: result.revision, outcome: result.outcome };
    }),
    refused("AgentPlanRecoveryRepository.control", (world) =>
      recovery(world).control(OWNER, "run-recovery", {
        ...REPAIR_COMMAND,
        instruction: "Anders",
      }),
    ),
    // Fixed identifiers above every generated one, whose place among them is random.
    prepare(`
      INSERT INTO agent_plan_repair_attempts (id, run_id, user_id, step_id, action, idempotency_key, request_digest, expected_revision, result_revision, attempt_json, result_json)
      SELECT
          'z-attempt-' || CAST(number AS TEXT),
          run_id,
          user_id,
          step_id,
          action,
          'attempt-copy-' || CAST(number AS TEXT),
          request_digest,
          expected_revision,
          result_revision,
          replace(attempt_json, 'Bitte wiederholen', 'Kopie ' || CAST(number AS TEXT)),
          result_json
      FROM agent_plan_repair_attempts, generate_series(1, 9) AS numbers(number)
      WHERE run_id = 'run-recovery';
    `),
    // An index read backwards undoes a reversed table, so both physical orders are read.
    callAtAnyTime("AgentPlanRecoveryRepository.inspect", (world) =>
      recovery(world).inspect("run-recovery"),
    ),
    reversedInPostgres("agent_plan_repair_attempts"),
    callAtAnyTime("AgentPlanRecoveryRepository.inspect", (world) =>
      recovery(world).inspect("run-recovery"),
    ),
    call("AgentPlanRecoveryRepository.inspect", ({ database }) =>
      new AgentPlanRecoveryRepository({
        transaction: (work) => database.transaction(work),
      })
        .inspect("run-recovery")
        .then((record) => record.revision),
    ),
    refused("AgentPlanRecoveryRepository.control", (world) =>
      recovery(world).control(OWNER, "run-recovery", {
        expectedRevision: 1,
        idempotencyKey: "resume-key-1",
        action: "resume",
        mode: "live",
        reviewedStepIds: [],
      }),
    ),
    call("AgentPlanRecoveryRepository.control", async (world) => {
      const result = await recovery(world).control(OWNER, "run-recovery", {
        expectedRevision: 1,
        idempotencyKey: "cancel-key-1",
        action: "cancel",
      });
      return { revision: result.revision, outcome: result.outcome };
    }),
    stored(
      "SELECT status, recovery_revision FROM agent_plan_runs WHERE id = 'run-recovery';",
    ),
  ],
};
