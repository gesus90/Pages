import {
  planStepExecutionSchema,
  planRemoteProgressSchema,
} from "@/definition/AgentPlanExecution";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { readPlanScriptRun } from "@/backend/agents/AgentPlanScriptRunInput";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readTextColumn } from "@/backend/database/RowValue";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import {
  allPlanRunResults,
  hasUnconfirmedLoopCloseout,
} from "@/definition/AgentPlanLoopResults";
import { isRemoteCloseoutUnconfirmed } from "@/definition/AgentPlanRemoteCloseout";
import {
  loopIterationCheckpoints,
  requireImmutableIterations,
} from "@/backend/service/agents/recovery/AgentPlanLoopCheckpoint";

import { CURRENT_PLAN_SNAPSHOT } from "./AgentPlanContinuationRepository";
import { AgentPlanCheckpointRepository } from "./AgentPlanCheckpointRepository";
import { AgentPlanLoopIterationRepository } from "./AgentPlanLoopIterationRepository";

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

function isCleanupUnconfirmed(step: AgentPlanStepResult): boolean {
  if (isRemoteCloseoutUnconfirmed(step)) return true;
  return [
    step.remote?.closeout,
    step.session?.closeout,
    step.script?.closeout,
  ].some((closeout) => closeout === "pending" || closeout === "failed");
}

function successfulWorkDigest(step: AgentPlanStepResult): string {
  const session = step.session;
  // Schema order keeps new metadata equivalent before and after a persisted read.
  return planContentDigest({
    execution: step.execution
      ? planStepExecutionSchema.parse(step.execution)
      : null,
    remote: step.remote ? planRemoteProgressSchema.parse(step.remote) : null,
    output: step.output,
    script: step.script ? readPlanScriptRun(step.script) : null,
    report: step.report ?? null,
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
  requireImmutableIterations(previous, run, successfulWorkDigest);
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

function hasTicketWorkGate(snapshot: unknown, stepId: string): boolean {
  const plan = readAgentObject(readAgentObject(snapshot).plan);
  const nodes: readonly unknown[] = Array.isArray(plan.nodes) ? plan.nodes : [];
  return nodes.some((entry) => {
    const node = readAgentObject(entry);
    return (
      node.id === stepId && readAgentObject(node.completionGate).version === 1
    );
  });
}

function hasRemoteAcceptanceGate(snapshot: unknown, stepId: string): boolean {
  const basis = readAgentObject(snapshot);
  const steps: readonly unknown[] = Array.isArray(basis.remoteSteps)
    ? basis.remoteSteps
    : [];
  return steps.some((entry) => {
    const remote = readAgentObject(entry);
    const program = readAgentObject(readAgentObject(remote.command).program);
    return (
      readAgentObject(remote.step).id === stepId &&
      program.kind === "cli" &&
      remote.acceptanceContract !== undefined
    );
  });
}

const REMOTE_ACCEPTANCE_FAILURES = new Set([
  "plan_acceptance_failed",
  "plan_acceptance_unavailable",
  "plan_acceptance_contract_unavailable",
  "plan_acceptance_interrupted",
  "opencode_acceptance_failed",
  "opencode_acceptance_unavailable",
  "opencode_acceptance_contract_unavailable",
]);

function isAllowedGateResult(
  step: AgentPlanStepResult,
  checkpoint: AgentPlanCheckpointInput | undefined,
  ticketGate: boolean,
  acceptanceGate: boolean,
): boolean {
  if (step.status === "succeeded")
    return (
      checkpoint?.stepId === step.id &&
      step.session?.acceptance?.verdict === "accepted"
    );
  return (
    step.status === "failed" &&
    ((ticketGate && step.error === "plan_work_gate_failed") ||
      (acceptanceGate &&
        step.error !== null &&
        REMOTE_ACCEPTANCE_FAILURES.has(step.error))) &&
    step.session?.resultCode === -1
  );
}

function settlesRemoteGate(input: {
  readonly snapshot: unknown;
  readonly stored: AgentPlanStepResult;
  readonly next: AgentPlanStepResult;
  readonly checkpoint: AgentPlanCheckpointInput | undefined;
}): boolean {
  const { stored, next } = input;
  const ticketGate = hasTicketWorkGate(input.snapshot, next.id);
  const acceptanceGate = hasRemoteAcceptanceGate(input.snapshot, next.id);
  return (
    stored.status === "running" &&
    stored.remote?.status === "completed" &&
    (ticketGate || acceptanceGate) &&
    isAllowedGateResult(next, input.checkpoint, ticketGate, acceptanceGate) &&
    stored.execution !== undefined &&
    next.execution !== undefined &&
    planContentDigest(planStepExecutionSchema.parse(stored.execution)) ===
      planContentDigest(planStepExecutionSchema.parse(next.execution))
  );
}

/** Run progress, successful completion and workspace release form one transaction. */
export class AgentPlanProgressRepository {
  private readonly database: Pick<Database, "transaction">;
  private readonly checkpoints: AgentPlanCheckpointRepository;
  private readonly iterations = new AgentPlanLoopIterationRepository();

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
      run = {
        ...run,
        stopRequested: previous.run.stopRequested || run.stopRequested,
        status:
          previous.run.stopRequested &&
          !isActivePlanRun(previous.run.status) &&
          isActivePlanRun(run.status)
            ? previous.run.status
            : run.status,
        steps: run.steps.map((step) => {
          const stored = previous.run.steps.find(
            (entry) => entry.id === step.id,
          );
          const retained = stored?.resourceAccess
            ? { ...step, resourceAccess: stored.resourceAccess }
            : step;
          const isGateResult =
            stored &&
            settlesRemoteGate({
              snapshot: previous.snapshot,
              stored,
              next: step,
              checkpoint,
            });
          return stored?.remote
            ? {
                ...retained,
                status: isGateResult ? step.status : stored.status,
                output: stored.output,
                error: isGateResult ? step.error : stored.error,
                remote: stored.remote,
                session: isGateResult ? step.session : stored.session,
                report: stored.report,
                cancellation: stored.cancellation,
              }
            : retained;
        }),
      };
      await this.save(transaction, previous, run, checkpoint);
      await journal?.(transaction, run);
    });
  }

  /** Shares the caller's transaction with a runner journal and its acknowledgement. */
  public async persist(
    transaction: DatabaseTransaction,
    run: AgentPlanRun,
    checkpoint?: AgentPlanCheckpointInput,
  ): Promise<void> {
    const previous = await this.read(transaction, run.id);
    await this.save(transaction, previous, run, checkpoint);
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
    for (const iteration of loopIterationCheckpoints(previous.run, run))
      await this.iterations.append(transaction, iteration, revision);
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
    const hasUnconfirmedCleanup =
      hasUnconfirmedLoopCloseout(run) ||
      allPlanRunResults(run).some(isCleanupUnconfirmed);
    if (!isActivePlanRun(run.status) && !hasUnconfirmedCleanup)
      await transaction.execute(
        "DELETE FROM agent_plan_workspace_locks WHERE run_id = $id;",
        { id: run.id },
      );
  }
}
