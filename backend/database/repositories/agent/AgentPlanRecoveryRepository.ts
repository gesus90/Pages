import { randomUUID } from "node:crypto";

import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import {
  readPlanRecoveryCommand,
  readPlanContentDigest,
  readPlanRecoveryResult,
  readPlanRepairAttempt,
} from "@/backend/agents/AgentPlanRecoveryInput";
import { readTextColumn } from "@/backend/database/RowValue";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { canRecordPlanRepair } from "@/definition/AgentPlanRecovery";

import { AgentPlanCheckpointRepository } from "./AgentPlanCheckpointRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type {
  AgentPlanCheckpoint,
  AgentPlanRecoveryCommand,
  AgentPlanRecoveryResult,
  AgentPlanRepairAttempt,
} from "@/definition/AgentPlanRecovery";

/** One consistent read of the run, its completion and its separate recovery audit. */
export interface AgentPlanRecoveryRecord {
  readonly run: AgentPlanRun;
  readonly revision: number;
  readonly checkpoint: AgentPlanCheckpoint | null;
  readonly attempts: readonly AgentPlanRepairAttempt[];
  readonly agentStepIds: readonly string[];
}

interface RecoveryProgress {
  readonly run: AgentPlanRun;
  readonly revision: number;
  readonly agentStepIds: readonly string[];
}

function requireRecoverable(run: AgentPlanRun): void {
  if (!canRecordPlanRepair(run))
    throw new AgentPlanRecoveryError("action_unavailable");
}

function commandStep(
  progress: RecoveryProgress,
  command: AgentPlanRecoveryCommand,
): string | null {
  if (command.action === "cancel" || command.action === "resume") return null;
  if (
    !progress.agentStepIds.includes(command.stepId) ||
    !progress.run.steps.some(
      (step) => step.id === command.stepId && step.status === "failed",
    )
  )
    throw new AgentPlanRecoveryError("action_unavailable");
  return command.stepId;
}

function commandText(command: AgentPlanRecoveryCommand): string | null {
  if (command.action === "record_repair") return command.instruction;
  return command.action === "reconcile" ? command.note : null;
}

/** Serializes revision-fenced recovery decisions; no method starts or queues an agent. */
export class AgentPlanRecoveryRepository {
  private readonly database: Pick<Database, "transaction">;

  public constructor(database: Pick<Database, "transaction">) {
    this.database = database;
  }

  /** Reads a coherent recovery revision and the latest hundred append-only decisions. */
  public async inspect(runId: string): Promise<AgentPlanRecoveryRecord> {
    return this.database.transaction(async (transaction) => {
      const progress = await this.progress(transaction, runId);
      const checkpoint = await new AgentPlanCheckpointRepository(
        transaction,
      ).find(runId);
      const rows = await transaction.query(
        `
          SELECT attempt_json
          FROM agent_plan_repair_attempts
          WHERE run_id = $run_id
          ORDER BY result_revision DESC
          LIMIT 100;
        `,
        { run_id: runId },
      );
      return {
        ...progress,
        checkpoint,
        attempts: rows.map((row) =>
          readPlanRepairAttempt(
            JSON.parse(readTextColumn(row, 0, "attempt_json")),
          ),
        ),
      };
    });
  }

  /** Stores one authorized preparation or cancellation with an idempotent result. */
  public async control(
    userId: string,
    runId: string,
    input: AgentPlanRecoveryCommand,
    originalDigest?: string,
  ): Promise<AgentPlanRecoveryResult> {
    const command = readPlanRecoveryCommand(input);
    const requestDigest =
      originalDigest === undefined
        ? planContentDigest(command)
        : readPlanContentDigest(originalDigest);
    return this.database.transaction(async (transaction) => {
      const progress = await this.progress(transaction, runId);
      if (progress.run.userId !== userId)
        throw new AgentPlanRecoveryError("access_denied");
      const repeated = await this.replay(
        transaction,
        progress.run,
        command,
        requestDigest,
      );
      if (repeated) return repeated;
      if (progress.revision !== command.expectedRevision)
        throw new AgentPlanRecoveryError("revision_conflict");
      requireRecoverable(progress.run);
      if (command.action === "resume")
        throw new AgentPlanRecoveryError("workflow_unavailable");
      const revision = progress.revision + 1;
      const attempt = readPlanRepairAttempt({
        id: randomUUID(),
        runId,
        userId,
        stepId: commandStep(progress, command),
        action: command.action,
        text: commandText(command),
        status: command.action === "cancel" ? "cancelled" : "recorded",
        revision,
        createdAt: new Date().toISOString(),
      });
      const result: AgentPlanRecoveryResult = {
        commandId: attempt.id,
        revision,
        outcome: attempt.status,
      };
      await this.append(transaction, {
        command,
        attempt,
        result,
        requestDigest,
      });
      await this.advance(transaction, progress, command);
      return result;
    });
  }

  private async progress(
    transaction: DatabaseTransaction,
    runId: string,
  ): Promise<RecoveryProgress> {
    const [row] = await transaction.query(
      `
        SELECT
            view_json,
            recovery_revision,
            snapshot_json
        FROM agent_plan_runs
        WHERE id = $id;
      `,
      { id: runId },
    );
    if (!row) throw new AgentPlanRecoveryError("access_denied");
    const revision = Number(row[1]);
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new AgentPlanRecoveryError("checkpoint_invalid");
    return {
      run: readPlanRun(JSON.parse(readTextColumn(row, 0, "view_json"))),
      revision,
      agentStepIds: snapshotAgentStepIds(
        JSON.parse(readTextColumn(row, 2, "snapshot_json")),
      ),
    };
  }

  private async replay(
    transaction: DatabaseTransaction,
    run: AgentPlanRun,
    command: AgentPlanRecoveryCommand,
    requestDigest: string,
  ): Promise<AgentPlanRecoveryResult | null> {
    const [row] = await transaction.query(
      `
        SELECT
            request_digest,
            result_json
        FROM agent_plan_repair_attempts
        WHERE run_id = $run_id
            AND idempotency_key = $idempotency_key;
      `,
      {
        run_id: run.id,
        idempotency_key: planContentDigest(command.idempotencyKey),
      },
    );
    if (!row) return null;
    if (readTextColumn(row, 0, "request_digest") !== requestDigest)
      throw new AgentPlanRecoveryError("idempotency_conflict");
    return readPlanRecoveryResult(
      JSON.parse(readTextColumn(row, 1, "result_json")),
    );
  }

  private async append(
    transaction: DatabaseTransaction,
    recording: {
      readonly command: AgentPlanRecoveryCommand;
      readonly attempt: AgentPlanRepairAttempt;
      readonly result: AgentPlanRecoveryResult;
      readonly requestDigest: string;
    },
  ): Promise<void> {
    const { command, attempt, result } = recording;
    await transaction.execute(
      `
        INSERT INTO agent_plan_repair_attempts (
            id,
            run_id,
            user_id,
            step_id,
            action,
            idempotency_key,
            request_digest,
            expected_revision,
            result_revision,
            attempt_json,
            result_json
        )
        VALUES ($id, $run_id, $user_id, $step_id, $action, $idempotency_key, $request_digest, $expected_revision, $result_revision, $attempt_json, $result_json);
      `,
      {
        id: attempt.id,
        run_id: attempt.runId,
        user_id: attempt.userId,
        step_id: attempt.stepId,
        action: attempt.action,
        idempotency_key: planContentDigest(command.idempotencyKey),
        request_digest: recording.requestDigest,
        expected_revision: command.expectedRevision,
        result_revision: result.revision,
        attempt_json: JSON.stringify(attempt),
        result_json: JSON.stringify(result),
      },
    );
  }

  private async advance(
    transaction: DatabaseTransaction,
    progress: RecoveryProgress,
    command: AgentPlanRecoveryCommand,
  ): Promise<void> {
    let run = progress.run;
    if (command.action === "cancel")
      run = {
        ...run,
        status: "cancelled",
        stopRequested: true,
        recovery: undefined,
        steps: run.steps.map((step) =>
          step.status === "waiting" || step.status === "paused"
            ? { ...step, status: "cancelled", cancellation: "not_started" }
            : step,
        ),
      };
    await transaction.execute(
      `
        UPDATE agent_plan_runs
        SET status = $status,
            view_json = $view_json,
            recovery_revision = $revision
        WHERE id = $id
            AND recovery_revision = $previous_revision;
      `,
      {
        id: run.id,
        status: run.status,
        view_json: JSON.stringify(run),
        revision: progress.revision + 1,
        previous_revision: progress.revision,
      },
    );
  }
}

function snapshotAgentStepIds(input: unknown): readonly string[] {
  const snapshot = readAgentObject(input);
  if (!Array.isArray(snapshot.steps)) return [];
  return snapshot.steps.flatMap((entry: unknown) => {
    const step = readAgentObject(readAgentObject(entry).step);
    return step.type === "agent" ? [readPlanText(step.id)] : [];
  });
}
