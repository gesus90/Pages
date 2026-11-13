import { createHash } from "node:crypto";

import { AgentOperationError } from "@/backend/error/AgentOperationError";

/** Revisions cover the current state, including changes made by older UI and API clients. */
export function managementRevision(state: unknown): string {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}
/** A stale patch changes nothing and reports the revision to read again. */
export function requireManagementRevision(
  currentRevision: string,
  expectedRevision: string,
): void {
  if (currentRevision !== expectedRevision)
    throw new AgentOperationError("CONFLICT", { currentRevision });
}
