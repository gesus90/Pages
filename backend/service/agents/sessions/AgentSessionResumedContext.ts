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

/** The model an attempt ran with: the one the provider confirmed, else the one the plan requested. */
function attemptModel(
  attempt: AgentSessionAttemptRecord | null,
): string | null {
  return attempt?.confirmedModel.value ?? attempt?.requestedModel ?? null;
}

/**
 * Whether an earlier attempt's occupancy holds for the current one.
 * @remarks
 * A window is a property of the model, and another model counts its context
 * on its own, so a value measured under another model never stands against
 * the current one. An attempt that does not know its model yet keeps the
 * earlier value.
 */
function isSameModel(
  earlier: AgentSessionAttemptRecord,
  current: AgentSessionAttemptRecord | null,
): boolean {
  const model = attemptModel(current);
  const earlierModel = attemptModel(earlier);
  return model === null || earlierModel === null || model === earlierModel;
}

/**
 * The context occupancy the sidebar shows for an attempt.
 * @param store - Where the attempts are kept.
 * @param record - The record of the node's current attempt.
 * @param stored - The stored state of the current attempt, `null` before it has one.
 * @returns The occupancy of this attempt. For a resumed Claude Code session,
 * an earlier occupancy can fill in until this attempt reports it, provided
 * the model matches.
 * @remarks
 * A resumed Claude Code session still holds its context before the restart.
 * A Codex runner reads that context from the confirmed native thread itself.
 * OpenCode displays only the selected attempt's own reading.
 */
export async function attemptContext(
  store: Pick<AgentSessionStore, "findAttempt">,
  record: AgentPlanSessionRecord,
  stored: AgentSessionAttemptRecord | null,
): Promise<AgentSessionContextUsage> {
  const own = stored?.context ?? UNKNOWN_CONTEXT;
  if (record.runner === "opencode" || record.runner === "codex_cli") return own;
  if (own.contextUsed !== null) return own;
  const resumed = resumedAttemptIds(record);
  if (resumed.length === 0) return own;
  const earlier = newestReported(
    await Promise.all(resumed.map((attemptId) => store.findAttempt(attemptId))),
  );
  if (earlier === null || !isSameModel(earlier, stored)) return own;
  // The cost belongs to the attempt that incurred it and is never carried over.
  return {
    ...keepReportedContext(earlier.context, own),
    cost: own.cost ?? null,
  };
}
