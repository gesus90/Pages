import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";

/** A workspace or project the person cannot see is reported like one that does not exist. */
const NOT_FOUND_CODES: ReadonlySet<AgentErrorCode> = new Set([
  "workspace_access_denied",
  "workspace_not_found",
]);

/** The request was understood, but the registry or another registration stands in its way. */
const CONFLICT_CODES: ReadonlySet<AgentErrorCode> = new Set([
  "workspace_conflict",
  "workspace_path_conflict",
  "workspace_in_use",
]);

/**
 * Turns the failures of the workspace registry into the fixed codes of the agent API.
 *
 * @param error - Whatever the registry or its path rules threw.
 * @returns The agent error for a business failure, or the error unchanged.
 *
 * @remarks
 * No message of the registry is passed on, only its class: a path refusal
 * never tells a client whether a directory outside the approved area exists.
 */
export function translateWorkspaceError(error: unknown): unknown {
  if (!(error instanceof AgentError) || !error.code.startsWith("workspace_"))
    return error;
  if (NOT_FOUND_CODES.has(error.code))
    return new AgentOperationError("NOT_FOUND");
  if (error.code === "workspace_management_denied")
    return new AgentOperationError("FORBIDDEN");
  if (CONFLICT_CODES.has(error.code))
    return new AgentOperationError("CONFLICT");
  return new AgentOperationError("INVALID_REQUEST");
}
