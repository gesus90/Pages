import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";
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
    "scope",
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
  if (
    Buffer.byteLength(input.content, "utf8") >
    PAGES_AGENT_LIMITS.wikiContentBytes
  )
    throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
      constraint: "wikiContentBytes",
      limit: PAGES_AGENT_LIMITS.wikiContentBytes,
    });
  const assetIds = input.assetIds.map(identifier);
  if (new Set(assetIds).size !== assetIds.length)
    throw new AgentOperationError("INVALID_REQUEST");
  return {
    operationId: identifier(input.operationId),
    projectId: input.projectId === null ? null : identifier(input.projectId),
    ...(input.scope === undefined ? {} : { scope: readScope(input.scope) }),
    parentId: input.parentId === null ? null : identifier(input.parentId),
    title: input.title,
    content: input.content,
    icon: input.icon,
    assetIds,
  };
}

function readScope(input: unknown): "project" | "instance" | "private" {
  if (input !== "project" && input !== "instance" && input !== "private")
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}
