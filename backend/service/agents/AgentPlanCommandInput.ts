import { readPlanTemplateName } from "@/backend/agents/AgentPlanTemplateInput";
import { readPlanText } from "@/backend/agents/AgentPlanInput";

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
  readonly workspaceId: string | null;
  readonly confirmation: unknown;
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
  const isClone = operation === "plans.clone";
  requireParameterKeys(
    parameters,
    [
      "operationId",
      "planId",
      "expectedRevision",
      ...(isRun ? ["runId"] : []),
      ...(isTemplate ? ["nodeId", "name"] : []),
      ...(isClone ? ["name"] : []),
    ],
    [
      ...(isClone ? ["workspaceId"] : []),
      ...(operation === "plans.delete" ? ["confirmation"] : []),
    ],
  );
  return {
    operation,
    operationId: readIdentifier(parameters.operationId),
    planId: readIdentifier(parameters.planId),
    expectedRevision: readPageAgentRevision(parameters.expectedRevision),
    runId: isRun ? readIdentifier(parameters.runId) : null,
    nodeId: isTemplate ? readIdentifier(parameters.nodeId) : null,
    name: isTemplate
      ? readPlanTemplateName(parameters.name)
      : cloneName(parameters, isClone),
    workspaceId:
      isClone && parameters.workspaceId !== undefined
        ? readIdentifier(parameters.workspaceId)
        : null,
    confirmation:
      operation === "plans.delete" ? (parameters.confirmation ?? null) : null,
  };
}

function cloneName(
  parameters: Readonly<Record<string, unknown>>,
  isClone: boolean,
): string | null {
  return isClone ? readPlanText(parameters.name, 120) : null;
}
