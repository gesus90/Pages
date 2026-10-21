import { readPlanRecoveryCommand } from "@/backend/agents/AgentPlanRecoveryInput";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { canRecordPlanRepair } from "@/definition/AgentPlanRecovery";

import { sanitizeArtifactText } from "../AgentPlanOutput";
import { AgentPlanRecoveryActions } from "./AgentPlanRecoveryActions";
import { classifyPlanFailure } from "./AgentPlanFailure";
import {
  continuedRun,
  nodeModes,
  planResume,
  releaseOption,
  restartOption,
  resumeOption,
} from "./AgentPlanRecoveryPlanning";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type {
  AgentPlanCheckpoint,
  AgentPlanContinuationCapabilities,
  AgentPlanRecoveryBlocker,
  AgentPlanRecoveryCommand,
  AgentPlanRecoveryResult,
  AgentPlanRecoveryView,
  AgentPlanRepairAttempt,
} from "@/definition/AgentPlanRecovery";
import type { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import type { AgentPlanRecoveryRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryRepository";
import type { RecoveryActionDependencies } from "./AgentPlanRecoveryActions";
import type { RecoveryFacts } from "./AgentPlanRecoveryPlanning";

interface RecoveryDependencies {
  readonly runs: RecoveryActionDependencies["runs"];
  readonly recovery: AgentPlanRecoveryRepository;
  readonly checkpoints: AgentPlanCheckpointRepository;
  /**
   * The engine, plan and lease boundary that executes a restart, resume or
   * release; without it these stay unavailable, as they were before.
   */
  readonly execution?: Omit<RecoveryActionDependencies, "runs" | "checkpoints">;
}

const UNAVAILABLE = {
  available: false,
  reason: "workflow_unavailable",
} as const;

/** The view of a composition without an execution boundary, which can only record decisions. */
function recordingOnly(
  run: AgentPlanRun,
): Pick<
  AgentPlanRecoveryView,
  | "planRevision"
  | "currentPlanRevision"
  | "continuedBy"
  | "executions"
  | "restart"
  | "resume"
  | "release"
  | "isCleanupUnconfirmed"
  | "blockers"
> {
  return {
    planRevision: run.continuation?.planRevision ?? run.planRevision,
    currentPlanRevision: run.planRevision,
    continuedBy: null,
    executions: [],
    isCleanupUnconfirmed: false,
    restart: UNAVAILABLE,
    release: UNAVAILABLE,
    resume: {
      ...UNAVAILABLE,
      modes: [],
      reusedStepIds: [],
      reviewStepIds: [],
    },
    blockers: ["workflow_unavailable", "context_not_verified"],
  };
}

/** Without an execution boundary, no session mode can be executed. */
function recordingModes(
  capabilities: AgentPlanContinuationCapabilities | null | undefined,
): AgentPlanRecoveryView["nodes"][number]["modes"] {
  let nativeReason: AgentPlanRecoveryView["nodes"][number]["modes"][number]["reason"] =
    "capabilities_unknown";
  if (capabilities)
    nativeReason =
      capabilities.canResume || capabilities.canLoad
        ? "workflow_unavailable"
        : "native_capability_unavailable";
  return [
    { mode: "live", available: false, reason: "session_not_available" },
    { mode: "native_resume", available: false, reason: nativeReason },
    { mode: "new_session", available: false, reason: "workflow_unavailable" },
  ];
}

function recoveryState(run: AgentPlanRun): AgentPlanRecoveryView["state"] {
  if (run.stopRequested || run.status === "cancelled") return "cancelled";
  if (run.status !== "failed") return run.status;
  return run.recovery?.state ?? "failed_terminal";
}

function recoveryNodes(
  run: AgentPlanRun,
  attempts: readonly AgentPlanRepairAttempt[],
  terms: {
    readonly agentStepIds: readonly string[];
    readonly canExecute: boolean;
  },
): AgentPlanRecoveryView["nodes"] {
  const { agentStepIds } = terms;
  const loopIds = (run.loops ?? []).map((loop) => loop.id);
  return run.steps
    .filter((step) => step.status === "failed")
    .map((step) => ({
      stepId: step.id,
      error: step.error,
      failureClass: classifyPlanFailure(step),
      canRecordRepair:
        canRecordPlanRepair(run) && agentStepIds.includes(step.id),
      sideEffects: attempts.some(
        (attempt) =>
          attempt.stepId === step.id && attempt.action === "reconcile",
      )
        ? "reviewed"
        : "unknown",
      capabilities: step.session?.continuationCapabilities ?? null,
      modes: terms.canExecute
        ? nodeModes(step, loopIds.includes(step.id))
        : recordingModes(step.session?.continuationCapabilities),
    }));
}

function recoveryActions(
  run: AgentPlanRun,
  agentStepIds: readonly string[],
): AgentPlanRecoveryView["allowedActions"] {
  if (!canRecordPlanRepair(run)) return [];
  return run.steps.some(
    (step) => step.status === "failed" && agentStepIds.includes(step.id),
  )
    ? ["record_repair", "reconcile", "cancel"]
    : ["cancel"];
}

/** The actions of a disturbed run, each checked against the current state and rights. */
function executingOptions(
  facts: RecoveryFacts,
): ReturnType<typeof recordingOnly> {
  const plan = planResume(facts);
  const resume = resumeOption(facts, plan);
  const restart = restartOption(facts);
  const release = releaseOption(facts);
  return {
    planRevision:
      facts.run.continuation?.planRevision ?? facts.run.planRevision,
    currentPlanRevision: facts.plan.revision,
    continuedBy: continuedRun(facts.executions),
    executions: facts.executions,
    isCleanupUnconfirmed: facts.isReserved,
    blockers: [
      ...new Set(
        [restart.reason, resume.reason, release.reason].filter(
          (reason): reason is AgentPlanRecoveryBlocker =>
            reason !== null && reason !== "nothing_to_release",
        ),
      ),
    ],
    restart,
    release,
    resume: {
      ...resume,
      modes: [
        {
          mode: "native_resume",
          available: resume.available && plan.canResumeNatively,
        },
        { mode: "new_session", available: resume.available },
      ],
      reusedStepIds: plan.reused.map((step) => step.id),
      reviewStepIds: plan.retriedStepIds,
    },
  };
}

/**
 * Authorized inspection and the explicit restart, resume and release of a
 * disturbed run, besides the recorded repair preparations.
 *
 * @remarks
 * Restart and resume each start a new run through the existing engine; the
 * disturbed run, its failures, checkpoints and journal stay unchanged.
 */
export class AgentPlanRecoveryService {
  private readonly dependencies: RecoveryDependencies;
  private readonly actions: AgentPlanRecoveryActions | null;
  private readonly controls = new SerialQueue();

  public constructor(dependencies: RecoveryDependencies) {
    this.dependencies = dependencies;
    this.actions = dependencies.execution
      ? new AgentPlanRecoveryActions({
          ...dependencies.execution,
          runs: dependencies.runs,
          checkpoints: dependencies.checkpoints,
        })
      : null;
  }

  /** Rechecks the executor's current plan, agent, workspace, ticket and asset rights on every read. */
  public async view(
    userId: string,
    runId: string,
  ): Promise<AgentPlanRecoveryView> {
    await this.dependencies.runs.run(userId, runId);
    const record = await this.dependencies.recovery.inspect(runId);
    if (record.run.userId !== userId)
      throw new AgentPlanRecoveryError("access_denied");
    const options = this.actions
      ? executingOptions((await this.actions.facts(userId, runId)).facts)
      : recordingOnly(record.run);
    return {
      runId,
      planId: record.run.planId,
      stepNames: Object.fromEntries(
        record.run.steps.map((step) => [step.id, step.name]),
      ),
      revision: record.revision,
      origin: record.run.origin ?? null,
      ...options,
      state: recoveryState(record.run),
      checkpoint: record.checkpoint,
      attempts: record.attempts,
      nodes: recoveryNodes(record.run, record.attempts, {
        agentStepIds: record.agentStepIds,
        canExecute: this.actions !== null,
      }),
      allowedActions: recoveryActions(record.run, record.agentStepIds),
    };
  }

  /** Reads an immutable original completion without disclosing the private snapshot's prompts. */
  public async checkpoint(
    userId: string,
    runId: string,
    version?: number,
  ): Promise<AgentPlanCheckpoint | null> {
    await this.dependencies.runs.run(userId, runId);
    if (
      version !== undefined &&
      (!Number.isSafeInteger(version) || version < 1)
    )
      throw new AgentPlanRecoveryError("invalid_request");
    return this.dependencies.checkpoints.find(runId, version);
  }

  /**
   * Records a repair or reconciliation, cancels, or explicitly restarts,
   * resumes or releases the run.
   *
   * @remarks
   * Every command needs the run's current recovery revision and an
   * idempotency key; a repeated request returns its first result and never
   * starts a second run.
   */
  public async control(
    userId: string,
    runId: string,
    input: unknown,
  ): Promise<AgentPlanRecoveryResult> {
    // The idempotency read must also cover preparation, before another command can create its run.
    return this.controls.run(() => this.executeControl(userId, runId, input));
  }

  private async executeControl(
    userId: string,
    runId: string,
    input: unknown,
  ): Promise<AgentPlanRecoveryResult> {
    await this.dependencies.runs.run(userId, runId);
    const original = readPlanRecoveryCommand(input);
    const requestDigest = planContentDigest(original);
    const command = this.sanitize(original);
    const { actions } = this;
    if (actions && command.action === "restart")
      return actions.restart({ userId, runId, command, requestDigest });
    if (actions && command.action === "resume")
      return actions.resume({ userId, runId, command, requestDigest });
    if (actions && command.action === "release")
      return actions.release({ userId, runId, command, requestDigest });
    return this.dependencies.recovery.control(
      userId,
      runId,
      command,
      requestDigest,
    );
  }

  private sanitize(
    command: AgentPlanRecoveryCommand,
  ): AgentPlanRecoveryCommand {
    if (command.action === "record_repair")
      return {
        ...command,
        instruction: sanitizeArtifactText(command.instruction),
      };
    if (command.action === "reconcile")
      return { ...command, note: sanitizeArtifactText(command.note) };
    return command;
  }
}
