import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type { AgentPlanRecoveryCommand } from "@/definition/AgentPlanRecovery";
import type { AgentPlanRecoveryCommandResult } from "@/definition/AgentPlanOperations";
import type { AgentPlanService } from "./AgentPlanService";
import type { AgentPlanRecoveryService } from "./recovery/AgentPlanRecoveryService";

type RecoveryStart = "restart" | "resume";
type StartCommand = Extract<
  AgentPlanRecoveryCommand,
  { action: RecoveryStart }
>;

interface RecoveryStartRequest {
  readonly planId: string;
  readonly runId: string;
  readonly command: StartCommand;
}

function revision(value: unknown, minimum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return value;
}

function reviewedSteps(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new AgentOperationError("INVALID_REQUEST");
  const steps = value.map(readIdentifier);
  if (new Set(steps).size !== steps.length)
    throw new AgentOperationError("INVALID_REQUEST");
  return steps;
}

/** Validates an explicit decision before it reaches the recovery service. */
function readStart(
  action: RecoveryStart,
  input: unknown,
): RecoveryStartRequest {
  const parameters = readParameterRecord(input);
  const common = ["operationId", "planId", "runId", "expectedRecoveryRevision"];
  requireParameterKeys(parameters, [
    ...common,
    ...(action === "restart"
      ? ["expectedPlanRevision", "confirmRepeat"]
      : ["expectedPlanRevision", "mode", "reviewedStepIds"]),
  ]);
  const operationId = readIdentifier(parameters.operationId);
  const identity = {
    expectedRevision: revision(parameters.expectedRecoveryRevision, 0),
    idempotencyKey: planContentDigest([
      "agent-api-recovery-start",
      operationId,
    ]),
  };
  const planId = readIdentifier(parameters.planId);
  const runId = readIdentifier(parameters.runId);
  if (action === "restart") {
    if (parameters.confirmRepeat !== true)
      throw new AgentOperationError("INVALID_REQUEST");
    return {
      planId,
      runId,
      command: {
        ...identity,
        action,
        revision: revision(parameters.expectedPlanRevision, 1),
        confirmRepeat: true,
      },
    };
  }
  if (parameters.mode !== "native_resume" && parameters.mode !== "new_session")
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    planId,
    runId,
    command: {
      ...identity,
      action,
      revision: revision(parameters.expectedPlanRevision, 1),
      mode: parameters.mode,
      reviewedStepIds: reviewedSteps(parameters.reviewedStepIds),
    },
  };
}

/** Starts a separately requested restart or recovery continuation of the executor's own run. */
export async function startRecoveredPlanRun(
  services: {
    readonly plans: Pick<AgentPlanService, "run">;
    readonly recovery?: Pick<AgentPlanRecoveryService, "control">;
  },
  userId: string,
  action: RecoveryStart,
  input: unknown,
): Promise<AgentPlanRecoveryCommandResult> {
  const request = readStart(action, input);
  const run = await services.plans.run(userId, request.runId);
  if (run.planId !== request.planId) throw new AgentOperationError("NOT_FOUND");
  if (!services.recovery)
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "plan_recovery_action_unavailable",
    });
  const result = await services.recovery.control(
    userId,
    request.runId,
    request.command,
  );
  if (result.outcome !== "started" || !result.runId)
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "plan_recovery_action_unavailable",
    });
  return {
    planId: request.planId,
    runId: request.runId,
    startedRunId: result.runId,
    commandId: result.commandId,
    recoveryRevision: result.revision,
    action,
    outcome: "started",
  };
}
