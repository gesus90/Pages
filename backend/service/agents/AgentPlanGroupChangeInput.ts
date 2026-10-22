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
  if (change.action === "placeNode" || change.action === "placeLoopNode") {
    const frameKey = change.action === "placeLoopNode" ? "loopId" : "groupId";
    requireParameterKeys(change, ["action", "nodeId", frameKey, "x", "y"]);
    return {
      action: change.action,
      nodeId: readIdentifier(change.nodeId),
      groupId:
        change[frameKey] === null ? null : readIdentifier(change[frameKey]),
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
