import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AGENT_PLAN_SESSION_READ_LIMITS } from "@/definition/AgentPlanSessionEvents";

import { chunkAgentRead } from "./AgentReadChunking";
import { sanitizeArtifactText } from "./AgentPlanOutput";
import { MAXIMUM_EVENT_TEXT } from "./sessions/AgentSessionJournal";
import {
  readIdentifier,
  readParameterRecord,
  requireParameterKeys,
} from "./AgentParameterReader";

import type { AgentPlanReadResult } from "@/definition/AgentPlanOperations";
import type { AgentSessionService } from "./sessions/AgentSessionService";
import type { AgentSessionEventPage } from "@/definition/AgentSessionJournal";

function filteredHistory(history: AgentSessionEventPage): {
  readonly history: AgentSessionEventPage;
  readonly isFiltered: boolean;
} {
  let isFiltered = false;
  const events = history.events.map((event) => {
    const safe = sanitizeArtifactText(event.text);
    const text = safe.slice(0, MAXIMUM_EVENT_TEXT);
    isFiltered ||= text !== event.text;
    return {
      ...event,
      text,
      isTruncated: event.isTruncated || safe.length > text.length,
    };
  });
  return { history: { ...history, events }, isFiltered };
}

function readInteger(input: unknown, minimum: number, maximum: number): number {
  if (
    typeof input !== "number" ||
    !Number.isSafeInteger(input) ||
    input < minimum ||
    input > maximum
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

function readAttemptId(input: unknown): string {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.length > AGENT_PLAN_SESSION_READ_LIMITS.attemptIdLength
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return input;
}

/** Reads the same authorized attempt journal as the editor, without offering session control. */
export async function readPlanSessionEvents(
  sessions: Pick<AgentSessionService, "history">,
  userId: string,
  input: unknown,
): Promise<AgentPlanReadResult> {
  const fields = readParameterRecord(input);
  requireParameterKeys(
    fields,
    ["planId", "runId", "stepId", "attemptId"],
    ["after", "before", "limit", "cursor", "maxBytes"],
  );
  const key = {
    planId: readIdentifier(fields.planId),
    runId: readIdentifier(fields.runId),
    stepId: readIdentifier(fields.stepId),
    attemptId: readAttemptId(fields.attemptId),
  };
  const after = readInteger(
    fields.after === undefined ? 0 : fields.after,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const before =
    fields.before === undefined
      ? undefined
      : readInteger(fields.before, 1, Number.MAX_SAFE_INTEGER);
  if (before !== undefined && before <= after)
    throw new AgentOperationError("INVALID_REQUEST");
  const limit = readInteger(
    fields.limit === undefined
      ? AGENT_PLAN_SESSION_READ_LIMITS.defaultEventPage
      : fields.limit,
    1,
    AGENT_PLAN_SESSION_READ_LIMITS.eventPage,
  );
  const history = await sessions.history(userId, key, {
    after,
    before,
    limit,
  });
  return chunkAgentRead(
    { sessionEvents: { key, ...filteredHistory(history) } },
    {
      context: JSON.stringify([
        userId,
        "plans.run.session.events.read",
        key,
        after,
        before,
        limit,
      ]),
      cursor: fields.cursor,
      maxBytes: fields.maxBytes,
    },
  );
}
