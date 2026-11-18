import { UNKNOWN_CONTEXT, keepReportedContext } from "./AgentSessionUsage";

import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { AgentSessionContextUsage } from "@/definition/AgentSessionJournal";
import type {
  AgentSessionAttemptRecord,
  AgentSessionStore,
} from "./AgentSessionStore";

/**
 * The attempts of a node whose native session a restart continues.
 * @param record - The record of the node's current attempt.
 * @returns The earlier attempts that reported a native session, which the
 * next attempt resumes; an attempt without one, or one whose session could
 * not be resumed, opened a conversation of its own and passes nothing on.
 */
function resumedAttemptIds(record: AgentPlanSessionRecord): readonly string[] {
  return (record.retry?.attempts ?? []).flatMap((entry) =>
    entry.attemptId !== null &&
    entry.sessionId !== null &&
    entry.code !== "acp_session_resume_failed"
      ? [entry.attemptId]
      : [],
  );
}

function newestReported(
  attempts: readonly (AgentSessionAttemptRecord | null)[],
): AgentSessionAttemptRecord | null {
  return attempts.reduce<AgentSessionAttemptRecord | null>(
    (newest, attempt) => {
      if (attempt === null || attempt.context.contextUsed === null)
        return newest;
      if (newest === null) return attempt;
      return (attempt.context.reportedAt ?? "") >
        (newest.context.reportedAt ?? "")
        ? attempt
        : newest;
    },
    null,
  );
}

/**
 * The context occupancy the sidebar shows for an attempt.
 * @param store - Where the attempts are kept.
 * @param record - The record of the node's current attempt.
 * @param stored - The stored state of the current attempt, `null` before it has one.
 * @returns The occupancy of the attempt itself once it reported one; until
 * then, for a restart that resumes the native session of an earlier attempt,
 * the last occupancy that attempt reported, with the window of the new one
 * where it has it. Unknown only while no attempt of the session reported one.
 * @remarks
 * A resumed Claude Code session still holds everything it held before the
 * restart, so the occupancy does not start over until the new attempt
 * reports its own.
 */
export async function attemptContext(
  store: Pick<AgentSessionStore, "findAttempt">,
  record: AgentPlanSessionRecord,
  stored: AgentSessionAttemptRecord | null,
): Promise<AgentSessionContextUsage> {
  const own = stored?.context ?? UNKNOWN_CONTEXT;
  if (own.contextUsed !== null) return own;
  const resumed = resumedAttemptIds(record);
  if (resumed.length === 0) return own;
  const earlier = newestReported(
    await Promise.all(resumed.map((attemptId) => store.findAttempt(attemptId))),
  );
  if (earlier === null) return own;
  // The cost belongs to the attempt that incurred it and is never carried over.
  return {
    ...keepReportedContext(earlier.context, own),
    cost: own.cost ?? null,
  };
}
