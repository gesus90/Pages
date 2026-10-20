import { AgentOperationError } from "@/backend/error/AgentOperationError";

import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type { AgentPlanChange } from "./AgentPlanOperationInput";

function coordinate(input: unknown): number {
  if (
    typeof input !== "number" ||
    !Number.isInteger(input) ||
    input < 0 ||
    input > 6000
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

function position(input: unknown): { nodeId: string; x: number; y: number } {
  const entry = readParameterRecord(input);
  requireParameterKeys(entry, ["nodeId", "x", "y"]);
  return {
    nodeId: readIdentifier(entry.nodeId),
    x: coordinate(entry.x),
    y: coordinate(entry.y),
  };
}

/** Reads explicit membership and template insertion changes without accepting a replacement graph. */
export function readPlanGroupChange(
  change: Readonly<Record<string, unknown>>,
): AgentPlanChange {
  if (change.action === "insertTemplate") {
    requireParameterKeys(change, ["action", "templateId", "x", "y"]);
    return {
      action: "insertTemplate",
      templateId: readIdentifier(change.templateId),
      x: coordinate(change.x),
      y: coordinate(change.y),
    };
  }
  if (change.action === "placeNode") {
    requireParameterKeys(change, ["action", "nodeId", "groupId", "x", "y"]);
    return {
      action: "placeNode",
      nodeId: readIdentifier(change.nodeId),
      groupId: change.groupId === null ? null : readIdentifier(change.groupId),
      x: coordinate(change.x),
      y: coordinate(change.y),
    };
  }
  requireParameterKeys(change, ["action", "nodeId", "positions"]);
  if (!Array.isArray(change.positions) || change.positions.length > 50)
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    action: "ungroup",
    nodeId: readIdentifier(change.nodeId),
    positions: change.positions.map(position),
  };
}
