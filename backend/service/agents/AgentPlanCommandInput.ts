import { readPlanTemplateName } from "@/backend/agents/AgentPlanTemplateInput";

import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";
import { readPageAgentRevision } from "./PageAgentOperationInput";

import type { AgentPlanCommandOperation } from "@/definition/AgentPlanOperations";

/** Commands name the saved revision, never an executable client graph. */
export interface AgentPlanCommandRequest {
  readonly operation: AgentPlanCommandOperation;
  readonly operationId: string;
  readonly planId: string;
  readonly expectedRevision: number;
  readonly runId: string | null;
  readonly nodeId: string | null;
  readonly name: string | null;
}

/** Reads bounded command input before any persistence or execution. */
export function readPlanCommand(
  operation: AgentPlanCommandOperation,
  input: unknown,
): AgentPlanCommandRequest {
  const parameters = readParameterRecord(input);
  const isRun =
    operation === "plans.pause" ||
    operation === "plans.resume" ||
    operation === "plans.stop";
  const isTemplate = operation === "plans.templates.save";
  requireParameterKeys(parameters, [
    "operationId",
    "planId",
    "expectedRevision",
    ...(isRun ? ["runId"] : []),
    ...(isTemplate ? ["nodeId", "name"] : []),
  ]);
  return {
    operation,
    operationId: readIdentifier(parameters.operationId),
    planId: readIdentifier(parameters.planId),
    expectedRevision: readPageAgentRevision(parameters.expectedRevision),
    runId: isRun ? readIdentifier(parameters.runId) : null,
    nodeId: isTemplate ? readIdentifier(parameters.nodeId) : null,
    name: isTemplate ? readPlanTemplateName(parameters.name) : null,
  };
}
