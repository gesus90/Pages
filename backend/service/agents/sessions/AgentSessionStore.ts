import type { AcpProviderId } from "@/definition/AgentConfiguration";
import type {
  AgentSessionContextUsage,
  AgentSessionEvent,
  AgentSessionEventKind,
  AgentSessionEventPage,
  AgentSessionHistoryWindow,
  AgentSessionKey,
  AgentSessionMessage,
  AgentSessionMessageStatus,
  AgentSessionReportedValue,
  AgentSessionState,
  AgentSessionTurnUsage,
  AgentSessionWorkspace,
} from "@/definition/AgentSessionJournal";

/** An event before the store gave it its sequence and identifier. */
export interface NewAgentSessionEvent {
  readonly turn: number | null;
  readonly kind: AgentSessionEventKind;
  readonly text: string;
  readonly isTruncated: boolean;
  readonly createdAt: string;
  /** A second event with the same key in the same attempt is dropped, such as a repeated tool result. */
  readonly dedupeKey: string | null;
}

/** The durable state of one node attempt. */
export interface AgentSessionAttemptRecord {
  readonly key: AgentSessionKey;
  /** The executor of the run, the only person who may read or steer the session. */
  readonly userId: string;
  readonly provider: AcpProviderId;
  /** The process instance; members of an ACP group share it. */
  readonly instanceId: string;
  readonly groupId: string | null;
  readonly state: AgentSessionState;
  readonly context: AgentSessionContextUsage;
  readonly confirmedModel: AgentSessionReportedValue;
  readonly confirmedReasoning: AgentSessionReportedValue;
  readonly workspace: AgentSessionWorkspace | null;
  readonly updatedAt: string;
}

/** A page of stored events and where retention cut the history. */
export interface StoredSessionEvents {
  readonly events: readonly AgentSessionEvent[];
  /** The first sequence retention kept; `null` while nothing was removed. */
  readonly retainedFrom: number | null;
}

/**
 * Durable storage of PageAgentCLI sessions: attempts, events, usage and messages.
 *
 * @remarks
 * Appending events assigns sequences and removes events beyond the retention
 * in one transaction, so a crash never leaves a gap or a duplicate sequence.
 * A message status changes only from an expected status, which makes every
 * delivery step happen at most once.
 */
export interface AgentSessionStore {
  saveAttempt(attempt: AgentSessionAttemptRecord): Promise<void>;
  findAttempt(attemptId: string): Promise<AgentSessionAttemptRecord | null>;
  appendEvents(
    attemptId: string,
    events: readonly NewAgentSessionEvent[],
    retain: number,
  ): Promise<readonly AgentSessionEvent[]>;
  readEvents(
    attemptId: string,
    after: number,
    limit: number,
  ): Promise<StoredSessionEvents>;
  /** Reads a bounded archive window when the production chunk journal is available. */
  readWindow?(
    attemptId: string,
    window: AgentSessionHistoryWindow,
  ): Promise<AgentSessionEventPage>;
  saveTurnUsage(usage: AgentSessionTurnUsage): Promise<void>;
  /** Every turn of every attempt of a run, for the run's sums. */
  listRunUsage(runId: string): Promise<readonly AgentSessionTurnUsage[]>;
  saveMessage(message: AgentSessionMessage): Promise<void>;
  /**
   * Moves a message to `status` only from one of `from`.
   *
   * @returns Whether this call changed it; `false` when another call came first.
   */
  updateMessage(
    id: string,
    from: readonly AgentSessionMessageStatus[],
    status: AgentSessionMessageStatus,
  ): Promise<boolean>;
  listMessages(attemptId: string): Promise<readonly AgentSessionMessage[]>;
  /**
   * Marks every delivery a stopped server left `delivering` as `uncertain`.
   *
   * @returns How many messages changed.
   */
  markUncertainDeliveries(): Promise<number>;
}
