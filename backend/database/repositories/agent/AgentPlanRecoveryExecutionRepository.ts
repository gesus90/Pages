import { isDeepStrictEqual } from "node:util";

import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import {
  readPlanRecoveryExecution,
  readPlanRecoveryResult,
} from "@/backend/agents/AgentPlanRecoveryInput";
import { readTextColumn } from "@/backend/database/RowValue";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { CURRENT_PLAN_SNAPSHOT } from "./AgentPlanContinuationRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type {
  AgentPlanRecoveryCommand,
  AgentPlanRecoveryExecution,
  AgentPlanRecoveryResult,
} from "@/definition/AgentPlanRecovery";

/** The earlier run, its recovery revision and the basis it ran with. */
export interface RecoverySource {
  readonly run: AgentPlanRun;
  readonly revision: number;
  /** The server-only snapshot of the earlier run, as its last continuation adopted it. */
  readonly snapshot: unknown;
}

/** One executing decision as it is journaled, with the result a replay returns. */
export interface RecoveryExecutionWrite {
  readonly command: AgentPlanRecoveryCommand;
  readonly requestDigest: string;
  readonly execution: AgentPlanRecoveryExecution;
  readonly result: AgentPlanRecoveryResult;
}

/**
 * Journals restarts, resumes and releases of a disturbed run.
 *
 * @remarks
 * A decision is written in the transaction that creates its new run, after a
 * revision check of the earlier run and before its revision advances; a
 * second request with the same key returns the first result, and a request
 * against an older revision is refused. Nothing here starts a process.
 */
export class AgentPlanRecoveryExecutionRepository {
  private readonly database: Pick<Database, "query" | "transaction">;

  public constructor(database: Pick<Database, "query" | "transaction">) {
    this.database = database;
  }

  /** Reads the earlier run with the basis a resume continues from. */
  public async source(runId: string): Promise<RecoverySource> {
    const [row] = await this.database.query(
      `
        SELECT
            view_json,
            recovery_revision,
            ${CURRENT_PLAN_SNAPSHOT} AS snapshot_json
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
      snapshot: JSON.parse(readTextColumn(row, 2, "snapshot_json")),
    };
  }

  /** Lists the newest fifty decisions about one run, newest first. */
  public async list(
    runId: string,
  ): Promise<readonly AgentPlanRecoveryExecution[]> {
    const rows = await this.database.query(
      `
        SELECT execution_json
        FROM agent_plan_recovery_executions
        WHERE run_id = $run_id
        ORDER BY result_revision DESC
        LIMIT 50;
      `,
      { run_id: runId },
    );
    return rows.map((row) =>
      readPlanRecoveryExecution(
        JSON.parse(readTextColumn(row, 0, "execution_json")),
      ),
    );
  }

  /**
   * Returns the result of an earlier request with the same key.
   *
   * @throws {AgentPlanRecoveryError} `idempotency_conflict` when the key was used for another request.
   */
  public async replay(
    runId: string,
    command: AgentPlanRecoveryCommand,
    requestDigest: string,
    transaction?: DatabaseTransaction,
  ): Promise<AgentPlanRecoveryResult | null> {
    const [row] = await (transaction ?? this.database).query(
      `
        SELECT
            request_digest,
            result_json
        FROM agent_plan_recovery_executions
        WHERE run_id = $run_id
            AND idempotency_key = $idempotency_key;
      `,
      {
        run_id: runId,
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

  /**
   * Journals a decision and advances the earlier run's recovery revision.
   *
   * @throws {AgentPlanRecoveryError} `revision_conflict` when the run changed
   * since the executor read it.
   */
  public async record(
    transaction: DatabaseTransaction,
    write: RecoveryExecutionWrite,
  ): Promise<void> {
    const { command, execution, result } = write;
    const [row] = await transaction.query(
      "SELECT recovery_revision FROM agent_plan_runs WHERE id = $id;",
      { id: execution.runId },
    );
    if (!row || Number(row[0]) !== command.expectedRevision)
      throw new AgentPlanRecoveryError("revision_conflict");
    await transaction.execute(
      `
        INSERT INTO agent_plan_recovery_executions (
            id,
            run_id,
            user_id,
            action,
            idempotency_key,
            request_digest,
            expected_revision,
            result_revision,
            target_run_id,
            execution_json,
            result_json
        )
        VALUES ($id, $run_id, $user_id, $action, $idempotency_key, $request_digest, $expected_revision, $result_revision, $target_run_id, $execution_json, $result_json);
      `,
      {
        id: execution.id,
        run_id: execution.runId,
        user_id: execution.userId,
        action: execution.action,
        idempotency_key: planContentDigest(command.idempotencyKey),
        request_digest: write.requestDigest,
        expected_revision: command.expectedRevision,
        result_revision: result.revision,
        target_run_id: execution.targetRunId,
        execution_json: JSON.stringify(execution),
        result_json: JSON.stringify(result),
      },
    );
    await transaction.execute(
      `
        UPDATE agent_plan_runs
        SET recovery_revision = $revision
        WHERE id = $id
            AND recovery_revision = $previous_revision;
      `,
      {
        id: execution.runId,
        revision: result.revision,
        previous_revision: command.expectedRevision,
      },
    );
  }

  /** Releases an ended run only if the facts checked during closeout are still current. */
  public async releaseChecked(run: AgentPlanRun): Promise<void> {
    if (isActivePlanRun(run.status))
      throw new AgentPlanRecoveryError("action_unavailable");
    await this.database.transaction(async (transaction) => {
      await requireUnchangedRun(transaction, run);
      await transaction.execute(
        "DELETE FROM agent_plan_workspace_locks WHERE run_id = $run_id;",
        { run_id: run.id },
      );
    });
  }

  /** Journals a decision that starts no run, such as a release, in its own transaction. */
  public async recordAlone(
    write: RecoveryExecutionWrite,
    releasedRun?: AgentPlanRun,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      if (releasedRun) await requireUnchangedRun(transaction, releasedRun);
      await this.record(transaction, write);
      if (!releasedRun) return;
      const run =
        releasedRun.stopRequested &&
        ["running", "pausing", "paused", "stopping"].includes(
          releasedRun.status,
        )
          ? {
              ...releasedRun,
              status: "cancelled" as const,
              endedAt: new Date().toISOString(),
              steps: releasedRun.steps.map((step) =>
                ["running", "waiting", "paused"].includes(step.status)
                  ? {
                      ...step,
                      status: "cancelled" as const,
                      cancellation: "confirmed" as const,
                    }
                  : step,
              ),
            }
          : releasedRun;
      if (run !== releasedRun)
        await transaction.execute(
          `
        UPDATE agent_plan_runs
        SET status = $status, view_json = $view_json
        WHERE id = $run_id
            AND recovery_revision = $revision;
          `,
          {
            run_id: run.id,
            status: run.status,
            view_json: JSON.stringify(run),
            revision: write.result.revision,
          },
        );
      await transaction.execute(
        "DELETE FROM agent_plan_workspace_locks WHERE run_id = $run_id;",
        { run_id: run.id },
      );
    });
  }
}

/** Refuses to release a run whose facts changed after process and closeout checks. */
async function requireUnchangedRun(
  transaction: DatabaseTransaction,
  expected: AgentPlanRun,
): Promise<void> {
  const [row] = await transaction.query(
    "SELECT view_json FROM agent_plan_runs WHERE id = $id;",
    { id: expected.id },
  );
  if (!row) throw new AgentPlanRecoveryError("revision_conflict");
  const current = readPlanRun(JSON.parse(readTextColumn(row, 0, "view_json")));
  if (!isDeepStrictEqual(current, expected))
    throw new AgentPlanRecoveryError("revision_conflict");
}
