import { readPlanRecoveryCommand } from "@/backend/agents/AgentPlanRecoveryInput";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { canRecordPlanRepair } from "@/definition/AgentPlanRecovery";

import { sanitizeArtifactText } from "../AgentPlanOutput";
import { classifyPlanFailure } from "./AgentPlanFailure";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type {
  AgentPlanCheckpoint,
  AgentPlanContinuationCapabilities,
  AgentPlanRecoveryCommand,
  AgentPlanRecoveryResult,
  AgentPlanRecoveryView,
  AgentPlanRepairAttempt,
} from "@/definition/AgentPlanRecovery";
import type { AgentPlanCheckpointRepository } from "@/backend/database/repositories/agent/AgentPlanCheckpointRepository";
import type { AgentPlanRecoveryRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryRepository";
import type { AgentPlanService } from "../AgentPlanService";

interface RecoveryDependencies {
  readonly runs: Pick<AgentPlanService, "run">;
  readonly recovery: AgentPlanRecoveryRepository;
  readonly checkpoints: AgentPlanCheckpointRepository;
}

function recoveryState(run: AgentPlanRun): AgentPlanRecoveryView["state"] {
  if (run.stopRequested || run.status === "cancelled") return "cancelled";
  if (run.status !== "failed") return run.status;
  return run.recovery?.state ?? "failed_terminal";
}

function recoveryModes(
  capabilities: AgentPlanContinuationCapabilities | undefined,
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

function recoveryNodes(
  run: AgentPlanRun,
  attempts: readonly AgentPlanRepairAttempt[],
  agentStepIds: readonly string[],
): AgentPlanRecoveryView["nodes"] {
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
      modes: recoveryModes(step.session?.continuationCapabilities),
    }));
}

/** Authorized recovery inspection and preparations; execution stays behind the workflow prerequisite. */
export class AgentPlanRecoveryService {
  private readonly dependencies: RecoveryDependencies;

  public constructor(dependencies: RecoveryDependencies) {
    this.dependencies = dependencies;
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
    return {
      runId,
      revision: record.revision,
      state: recoveryState(record.run),
      checkpoint: record.checkpoint,
      attempts: record.attempts,
      nodes: recoveryNodes(record.run, record.attempts, record.agentStepIds),
      allowedActions: recoveryActions(record.run, record.agentStepIds),
      blockers: ["workflow_unavailable", "context_not_verified"],
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

  /** Records a separate repair/reconciliation decision or cancels; never dispatches a retry. */
  public async control(
    userId: string,
    runId: string,
    input: unknown,
  ): Promise<AgentPlanRecoveryResult> {
    await this.dependencies.runs.run(userId, runId);
    const original = readPlanRecoveryCommand(input);
    const command = this.sanitize(original);
    return this.dependencies.recovery.control(
      userId,
      runId,
      command,
      planContentDigest(original),
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
