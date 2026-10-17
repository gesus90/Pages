import { readPlanText } from "@/backend/agents/AgentPlanInput";

import type { AgentSessionKey } from "@/definition/AgentSessionJournal";

// Legacy attempts join the process instance and the node ID.
const MAXIMUM_ATTEMPT_ID = 300;

/**
 * Reads the session key of a PageAgentCLI request from the address.
 *
 * @param params - Route parameters with run and node.
 * @param search - Query with plan and attempt.
 * @throws {AgentError} `plan_invalid` for a missing or malformed part.
 */
export function readSessionKey(
  params: { readonly runId?: string; readonly stepId?: string },
  search: URLSearchParams,
): AgentSessionKey {
  return {
    planId: readPlanText(search.get("planId")),
    runId: readPlanText(params.runId),
    stepId: readPlanText(params.stepId),
    attemptId: readPlanText(search.get("attemptId"), MAXIMUM_ATTEMPT_ID),
  };
}

/**
 * Reads a history cursor; anything but a whole non-negative number reads from the start.
 *
 * @param input - The cursor as the client or `Last-Event-ID` sent it.
 */
export function readSessionCursor(input: string | null): number {
  const cursor = Number(input ?? "0");
  return Number.isSafeInteger(cursor) && cursor > 0 ? cursor : 0;
}
