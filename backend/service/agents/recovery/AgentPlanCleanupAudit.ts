import { randomUUID } from "node:crypto";

import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanRecoveryCommand } from "@/definition/AgentPlanRecovery";
import type { AgentPlanCleanupFailureRepository } from "@/backend/database/repositories/agent/AgentPlanCleanupFailureRepository";

/** Persists bounded failure evidence only after the caller authorized the original run and command. */
export async function auditCleanupFailure(
  repository: Pick<AgentPlanCleanupFailureRepository, "append"> | undefined,
  run: AgentPlanRun,
  command: AgentPlanRecoveryCommand,
  error: unknown,
): Promise<never> {
  if (
    !repository ||
    !(error instanceof AgentPlanRecoveryError) ||
    !error.cleanupFailure ||
    (command.action !== "release" &&
      command.action !== "restart" &&
      command.action !== "resume")
  )
    throw error;
  try {
    await repository.append(run.userId, {
      ...error.cleanupFailure,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      planId: run.planId,
      runId: run.id,
      planRevision: run.continuation?.planRevision ?? run.planRevision,
      recoveryRevision: command.expectedRevision,
      action: command.action,
      attemptId: originalAttempt(run, error.cleanupFailure.stepId),
    });
  } catch (auditError: unknown) {
    logCaughtError("AgentPlanCleanupAudit", auditError);
    throw new AgentPlanRecoveryError("diagnostic_unavailable");
  }
  throw error;
}

function originalAttempt(run: AgentPlanRun, stepId: string): string | null {
  const steps = allPlanRunResults(run).filter((step) => step.id === stepId);
  const step = steps.length === 1 ? steps[0] : undefined;
  return step?.script?.attemptId ?? step?.execution?.attemptId ?? null;
}
