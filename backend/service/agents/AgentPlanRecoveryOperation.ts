import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type { AgentPlanRecoveryCommandResult } from "@/definition/AgentPlanOperations";
import type { AgentPlanService } from "./AgentPlanService";
import type { AgentPlanRecoveryService } from "./recovery/AgentPlanRecoveryService";

/** Requests the existing recovery release for the executor's own run. */
export async function releasePlanRun(
  services: {
    readonly plans: Pick<AgentPlanService, "run">;
    readonly recovery?: Pick<AgentPlanRecoveryService, "control">;
  },
  userId: string,
  input: unknown,
): Promise<AgentPlanRecoveryCommandResult> {
  const parameters = readParameterRecord(input);
  requireParameterKeys(
    parameters,
    ["operationId", "planId", "runId"],
    ["expectedRecoveryRevision"],
  );
  const operationId = readIdentifier(parameters.operationId);
  const planId = readIdentifier(parameters.planId);
  const runId = readIdentifier(parameters.runId);
  const run = await services.plans.run(userId, runId);
  if (run.planId !== planId) throw new AgentOperationError("NOT_FOUND");
  if (!services.recovery)
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "plan_recovery_action_unavailable",
    });
  const result = await services.recovery.control(userId, runId, {
    action: "release",
    idempotencyKey: planContentDigest(["agent-api-release", operationId]),
  });
  if (result.outcome !== "released")
    throw new AgentOperationError("INVALID_REQUEST", {
      reason: "plan_recovery_action_unavailable",
    });
  return {
    planId,
    runId,
    commandId: result.commandId,
    recoveryRevision: result.revision,
    outcome: "released",
  };
}
