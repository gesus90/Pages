/**
 * Which node attempt a PageAgentCLI session belongs to.
 *
 * @remarks
 * Members of an ACP group share one adapter process, but every member has
 * its own attempt, so its turns, events and usage stay apart.
 */
export interface AgentSessionKey {
  readonly planId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly attemptId: string;
}

/** Where a session stands, as the read API and `send` see it. */
export type AgentSessionState =
  | "starting"
  | "running"
  | "waiting_for_input"
  | "idle"
  | "waiting_for_capacity"
  | "recovering"
  | "ended"
  | "failed"
  | "cancelled";

/** What one entry of the structured session history reports. */
export type AgentSessionEventKind =
  | "user_instruction"
  | "repair_instruction"
  | "agent_message"
  | "tool_started"
  | "tool_completed"
  | "tool_failed"
  | "plan"
  | "status"
  | "error"
  | "recovery"
  | "usage";

/** One persisted, redacted entry of the history of a node attempt. */
export interface AgentSessionEvent {
  /** Stable across reads and reconnects: attempt and sequence. */
  readonly id: string;
  /** Strictly increasing per attempt, from 1; the cursor of the history. */
  readonly sequence: number;
  readonly stepId: string;
  readonly attemptId: string;
  /** The turn of the attempt the event belongs to; `null` before the first turn. */
  readonly turn: number | null;
  readonly kind: AgentSessionEventKind;
  readonly createdAt: string;
  /** Redacted and shortened text; never a credential or an unbounded tool output. */
  readonly text: string;
  /** Whether the text was shortened to the storage limit. */
  readonly isTruncated: boolean;
  /** Native channel when reported by a runner; absent in historical/local structured entries. */
  readonly channel?: "stdout" | "stderr";
}

/** One page of history after a cursor, in sequence order. */
export interface AgentSessionEventPage {
  readonly events: readonly AgentSessionEvent[];
  /** Pass as `after` for the next page or for a reconnect; `null` while nothing is stored. */
  readonly cursor: number | null;
  readonly hasMore: boolean;
  /** Events before this sequence were removed by retention; `null` while nothing was removed. */
  readonly retainedFrom: number | null;
  /**
   * `journal` for a persisted structured history; `legacy_record` for a run
   * from before PAGE-85, whose short event lines are all that is known.
   */
  readonly source: "journal" | "legacy_record";
  /** Older retained entries are available before the first event of this window. */
  readonly hasEarlier?: boolean;
}

/** A bounded history window. `before` is exclusive; `tail` selects the newest retained page. */
export interface AgentSessionHistoryWindow {
  readonly after: number;
  readonly before?: number;
  readonly tail?: boolean;
  readonly limit: number;
}
