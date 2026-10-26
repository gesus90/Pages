import { readPlanText } from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";

import type {
  AgentSessionHistoryWindow,
  AgentSessionKey,
} from "@/definition/AgentSessionJournal";

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
 * Reads a history cursor; malformed or unsafe positions are rejected explicitly.
 *
 * @param input - The cursor as the client or `Last-Event-ID` sent it.
 */
export function readSessionCursor(input: string | null): number {
  if (input === null) return 0;
  if (!/^\d+$/u.test(input)) throw new AgentError("plan_invalid");
  const cursor = Number(input);
  if (!Number.isSafeInteger(cursor)) throw new AgentError("plan_invalid");
  return cursor;
}

/** Validates one exclusive sequence window; malformed or conflicting selectors are never treated as a complete history. */
export function readSessionHistoryWindow(
  search: URLSearchParams,
  limit: number,
): AgentSessionHistoryWindow {
  const after = readSessionCursor(search.get("after"));
  const before = search.has("before")
    ? readSessionCursor(search.get("before"))
    : undefined;
  const selector = search.get("tail");
  if (selector !== null && selector !== "0" && selector !== "1")
    throw new AgentError("plan_invalid");
  const tail = selector === "1";
  if (
    before === 0 ||
    (before !== undefined && (tail || after > 0)) ||
    (tail && after > 0)
  )
    throw new AgentError("plan_invalid");
  return {
    after,
    ...(before !== undefined ? { before } : {}),
    ...(tail ? { tail } : {}),
    limit,
  };
}
