import { planExecutionTargetSchema } from "@/definition/AgentPlanExecution";
import { readPlanTemplateName } from "@/backend/agents/AgentPlanTemplateInput";
import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import {
  readPlanTeamsParameter,
  readPlanOwnerParameter,
} from "./AgentPlanTeamInput";
import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";
import { readPageAgentRevision } from "./PageAgentOperationInput";

import type { AgentPlanCloneInput } from "./AgentPlanClone";
import type {
  AgentPlanCommandOperation,
  AgentPlanTemplateCommandOperation,
} from "@/definition/AgentPlanOperations";

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
  /** Set only for a clone that becomes a one-time plan (PAGE-309). */
  readonly oneShot?: true;
  readonly ownerId?: string;
  readonly teams?: AgentPlanCloneInput["teams"];
  readonly executionTarget?: AgentPlanCloneInput["executionTarget"];
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
      ...(isClone
        ? ["workspaceId", "oneShot", "ownerId", "teams", "executionTarget"]
        : []),
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
    ...readCloneTarget(parameters, isClone),
  };
}

/** Where a clone goes and whether the copy is a one-time plan; other commands name neither. */
function readCloneTarget(
  parameters: Readonly<Record<string, unknown>>,
  isClone: boolean,
): Pick<
  AgentPlanCommandRequest,
  "workspaceId" | "oneShot" | "ownerId" | "teams" | "executionTarget"
> {
  if (!isClone) return { workspaceId: null };
  const { workspaceId, oneShot } = parameters;
  if (oneShot !== undefined && typeof oneShot !== "boolean")
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    workspaceId: workspaceId === undefined ? null : readIdentifier(workspaceId),
    ...(oneShot === true ? { oneShot: true } : {}),
    ...(parameters.ownerId === undefined
      ? {}
      : { ownerId: readPlanOwnerParameter(parameters.ownerId) }),
    ...(parameters.teams === undefined
      ? {}
      : { teams: readPlanTeamsParameter(parameters.teams) }),
    ...(parameters.executionTarget === undefined
      ? {}
      : {
          executionTarget: planExecutionTargetSchema.parse(
            parameters.executionTarget,
          ),
        }),
  };
}

function cloneName(
  parameters: Readonly<Record<string, unknown>>,
  isClone: boolean,
): string | null {
  if (!isClone) return null;
  if (typeof parameters.name === "string" && parameters.name.trim() === "")
    return "";
  return readPlanText(parameters.name, 120);
}

/** A change or deletion of a stored node template, named with the workspace it is read in. */
export interface AgentPlanTemplateCommandRequest {
  readonly operation: AgentPlanTemplateCommandOperation;
  readonly operationId: string;
  readonly workspaceId: string;
  readonly templateId: string;
  /** The new name of an update; `null` keeps it. */
  readonly name: string | null;
  /** The plan and node whose node replaces the stored one; both or neither. */
  readonly source: {
    readonly planId: string;
    readonly nodeId: string;
  } | null;
}

/**
 * Reads `plans.templates.update` and `plans.templates.delete` before any persistence.
 *
 * @param operation - The template command.
 * @param input - The raw parameters.
 * @throws {AgentOperationError} `INVALID_REQUEST` for a missing, unknown or
 * malformed parameter, for `planId` without `nodeId` or the reverse, and for
 * an update that changes neither the name nor the node.
 */
export function readPlanTemplateCommand(
  operation: AgentPlanTemplateCommandOperation,
  input: unknown,
): AgentPlanTemplateCommandRequest {
  const parameters = readParameterRecord(input);
  const isUpdate = operation === "plans.templates.update";
  requireParameterKeys(
    parameters,
    ["operationId", "workspaceId", "templateId"],
    isUpdate ? ["name", "planId", "nodeId"] : ["confirmation"],
  );
  const { name, planId, nodeId } = parameters;
  if (
    isUpdate &&
    ((planId === undefined) !== (nodeId === undefined) ||
      (planId === undefined && name === undefined))
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    operation,
    operationId: readIdentifier(parameters.operationId),
    workspaceId: readIdentifier(parameters.workspaceId),
    templateId: readIdentifier(parameters.templateId),
    name: isUpdate && name !== undefined ? readPlanTemplateName(name) : null,
    source:
      planId === undefined
        ? null
        : { planId: readIdentifier(planId), nodeId: readIdentifier(nodeId) },
  };
}
