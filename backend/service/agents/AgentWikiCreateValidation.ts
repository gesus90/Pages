import { AgentOperationError } from "@/backend/error/AgentOperationError";

import type { AgentWikiCreateInput } from "@/definition/PagesAgentWrites";

function identifier(input: unknown): string {
  if (typeof input !== "string" || !input.trim() || input.length > 200)
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

/** Validates the complete explicit create contract before any object is written. */
export function readAgentWikiCreate(
  input: Readonly<Record<string, unknown>>,
): AgentWikiCreateInput {
  const allowed = [
    "operationId",
    "projectId",
    "parentId",
    "title",
    "content",
    "icon",
    "assetIds",
  ];
  if (
    Object.keys(input).some((key) => !allowed.includes(key)) ||
    typeof input.title !== "string" ||
    typeof input.content !== "string" ||
    (input.icon !== null && typeof input.icon !== "string") ||
    !Array.isArray(input.assetIds) ||
    input.assetIds.length > 100
  )
    throw new AgentOperationError("INVALID_REQUEST");
  const assetIds = input.assetIds.map(identifier);
  if (new Set(assetIds).size !== assetIds.length)
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    operationId: identifier(input.operationId),
    projectId: identifier(input.projectId),
    parentId: input.parentId === null ? null : identifier(input.parentId),
    title: input.title,
    content: input.content,
    icon: input.icon,
    assetIds,
  };
}
