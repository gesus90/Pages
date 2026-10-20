import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readTextColumn } from "@/backend/database/RowValue";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";

import { CURRENT_PLAN_SNAPSHOT } from "./AgentPlanContinuationRepository";
import { AgentPlanCheckpointRepository } from "./AgentPlanCheckpointRepository";

import type { AgentPlanRunJournal } from "@/backend/service/agents/AgentPlanJournal";
import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanCheckpointInput } from "@/definition/AgentPlanRecovery";

interface StoredProgress {
  readonly run: AgentPlanRun;
  readonly revision: number;
  readonly snapshot: unknown;
}

function successfulWorkDigest(step: AgentPlanStepResult): string {
  const session = step.session;
  return planContentDigest({
    output: step.output,
    session: session
      ? {
          instanceId: session.instanceId,
          runner: session.runner,
          mode: session.mode,
          attemptId: session.attemptId ?? null,
          sessionId: session.sessionId,
          requested: session.requested,
          definition: session.definition,
          contract: session.contract,
          acceptance: session.acceptance,
          dispatchedPromptDigest: session.dispatchedPromptDigest ?? null,
        }
      : null,
  });
}

function requireRunIdentity(previous: AgentPlanRun, run: AgentPlanRun): void {
  if (
    previous.userId !== run.userId ||
    previous.planId !== run.planId ||
    previous.planRevision !== run.planRevision
  )
    throw new AgentPlanRecoveryError("checkpoint_invalid");
  if (previous.stopRequested && !run.stopRequested)
    throw new AgentPlanRecoveryError("action_unavailable");
  if (
    (previous.status === "succeeded" ||
      previous.status === "cancelled" ||
      previous.status === "failed") &&
    previous.status !== run.status
  )
    throw new AgentPlanRecoveryError("action_unavailable");
}

function requireImmutableSuccess(
  previous: AgentPlanRun,
  run: AgentPlanRun,
): void {
  requireRunIdentity(previous, run);
  for (const completed of previous.steps.filter(
    (step) => step.status === "succeeded",
  )) {
    const next = run.steps.find((step) => step.id === completed.id);
    if (
      next?.status !== "succeeded" ||
      successfulWorkDigest(next) !== successfulWorkDigest(completed)
    )
      throw new AgentPlanRecoveryError("checkpoint_invalid");
  }
}

function requireCompletionCheckpoint(
  previous: StoredProgress,
  run: AgentPlanRun,
  checkpoint: AgentPlanCheckpointInput | undefined,
): void {
  const plan = readAgentObject(readAgentObject(previous.snapshot).plan);
  const nodes: readonly unknown[] = Array.isArray(plan.nodes) ? plan.nodes : [];
  const nodeIds = new Set(nodes.map((node) => readAgentObject(node).id));
  const newlyCompleted = run.steps.filter(
    (step) =>
      step.status === "succeeded" &&
      nodeIds.has(step.id) &&
      previous.run.steps.find((entry) => entry.id === step.id)?.status !==
        "succeeded",
  );
  if (newlyCompleted.some((step) => step.id !== checkpoint?.stepId))
    throw new AgentPlanRecoveryError("checkpoint_invalid");
}

/** Run progress, successful completion and workspace release form one transaction. */
export class AgentPlanProgressRepository {
  private readonly database: Pick<Database, "transaction">;
  private readonly checkpoints: AgentPlanCheckpointRepository;

  public constructor(database: Pick<Database, "transaction" | "query">) {
    this.database = database;
    this.checkpoints = new AgentPlanCheckpointRepository(database);
  }

  /** Persists a view with its completion, rejecting replacement of successful work. */
  public async update(
    run: AgentPlanRun,
    checkpoint?: AgentPlanCheckpointInput,
    journal?: AgentPlanRunJournal,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const previous = await this.read(transaction, run.id);
      await this.save(transaction, previous, run, checkpoint);
      await journal?.(transaction, run);
    });
  }

  /** Interrupts only active records; a concurrent terminal decision cannot be reopened. */
  public async interrupt(run: AgentPlanRun): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const previous = await this.read(transaction, run.id);
      if (!isActivePlanRun(previous.run.status)) return;
      await this.save(transaction, previous, run);
    });
  }

  private async read(
    transaction: DatabaseTransaction,
    id: string,
  ): Promise<StoredProgress> {
    const [row] = await transaction.query(
      `
        SELECT
            view_json,
            recovery_revision,
            ${CURRENT_PLAN_SNAPSHOT} AS snapshot_json
        FROM agent_plan_runs
        WHERE id = $id;
      `,
      { id },
    );
    if (!row) throw new AgentPlanRecoveryError("access_denied");
    if (!Number.isSafeInteger(Number(row[1])) || Number(row[1]) < 0)
      throw new AgentPlanRecoveryError("checkpoint_invalid");
    return {
      run: readPlanRun(JSON.parse(readTextColumn(row, 0, "view_json"))),
      revision: Number(row[1]),
      snapshot: JSON.parse(readTextColumn(row, 2, "snapshot_json")),
    };
  }

  private async save(
    transaction: DatabaseTransaction,
    previous: StoredProgress,
    run: AgentPlanRun,
    checkpoint?: AgentPlanCheckpointInput,
  ): Promise<void> {
    requireImmutableSuccess(previous.run, run);
    requireCompletionCheckpoint(previous, run, checkpoint);
    const revision = previous.revision + 1;
    if (checkpoint) {
      const step = run.steps.find((entry) => entry.id === checkpoint.stepId);
      if (
        checkpoint.runId !== run.id ||
        checkpoint.planId !== run.planId ||
        checkpoint.planRevision !== run.planRevision ||
        checkpoint.snapshotDigest !== planContentDigest(previous.snapshot) ||
        step?.status !== "succeeded" ||
        checkpoint.result.isOutputReduced !==
          (checkpoint.result.output !== step.output) ||
        checkpoint.result.outputDigest !== planContentDigest(step.output)
      )
        throw new AgentPlanRecoveryError("checkpoint_invalid");
      await this.checkpoints.append(transaction, checkpoint, revision);
    }
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
        revision,
        previous_revision: previous.revision,
      },
    );
    const hasUnconfirmedCleanup = run.steps.some(
      (step) =>
        step.session?.closeout === "pending" ||
        step.session?.closeout === "failed",
    );
    if (!isActivePlanRun(run.status) && !hasUnconfirmedCleanup)
      await transaction.execute(
        "DELETE FROM agent_plan_workspace_locks WHERE run_id = $id;",
        { id: run.id },
      );
  }
}
