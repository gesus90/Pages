import type {
  AgentSessionEventPage,
  AgentSessionHistoryWindow,
} from "@/definition/AgentSessionJournal";
import type { AgentSessionAttempt } from "./AgentSessionAttempts";

/** Reads the events kept in an older session record. */
export function legacySessionHistory(
  attempt: AgentSessionAttempt,
  page: AgentSessionHistoryWindow,
): AgentSessionEventPage {
  const { record, key } = attempt;
  const { after, before, limit } = page;
  const events = record.events
    .map((text, index) => ({
      id: `${key.attemptId}:${index + 1}`,
      sequence: index + 1,
      stepId: key.stepId,
      attemptId: key.attemptId,
      turn: null,
      kind: "status" as const,
      createdAt: record.turnEndedAt ?? record.startedAt ?? "",
      text,
      isTruncated: false,
    }))
    .filter(
      (event) =>
        event.sequence > after &&
        (before === undefined || event.sequence < before),
    );
  const selected = page.tail ? events.slice(-limit) : events.slice(0, limit);
  return {
    events: selected,
    cursor: selected.at(-1)?.sequence ?? (after > 0 ? after : null),
    hasMore: !page.tail && events.length > selected.length,
    hasEarlier: page.tail === true && events.length > selected.length,
    retainedFrom: null,
    source: "legacy_record",
  };
}
