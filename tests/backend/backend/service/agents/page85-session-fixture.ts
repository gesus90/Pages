import type {
  AgentSessionAttemptRecord,
  AgentSessionStore,
  NewAgentSessionEvent,
  StoredSessionEvents,
} from "@/backend/service/agents/sessions/AgentSessionStore";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type {
  AgentSessionEvent,
  AgentSessionMessage,
  AgentSessionMessageStatus,
  AgentSessionTurnUsage,
} from "@/definition/AgentSessionJournal";

/**
 * The PageAgentCLI tables in memory, with the transaction semantics of the repository.
 *
 * @remarks
 * Appending numbers events from the attempt's next sequence, drops duplicate
 * keys and removes events beyond the retention, like the SQL transaction.
 */
export class MemorySessionStore implements AgentSessionStore {
  public readonly attempts = new Map<string, AgentSessionAttemptRecord>();
  public readonly events = new Map<
    string,
    (AgentSessionEvent & { readonly dedupeKey: string | null })[]
  >();
  public readonly sequences = new Map<string, number>();
  public readonly usage = new Map<string, AgentSessionTurnUsage>();
  public readonly messages = new Map<string, AgentSessionMessage>();

  /** Stores an attempt and starts its sequence at 1. */
  public async saveAttempt(attempt: AgentSessionAttemptRecord): Promise<void> {
    this.attempts.set(attempt.key.attemptId, attempt);
    if (!this.sequences.has(attempt.key.attemptId))
      this.sequences.set(attempt.key.attemptId, 1);
  }

  /** Reads an attempt. */
  public async findAttempt(
    attemptId: string,
  ): Promise<AgentSessionAttemptRecord | null> {
    return this.attempts.get(attemptId) ?? null;
  }

  /** Numbers, deduplicates and retains events like the repository transaction. */
  public async appendEvents(
    attemptId: string,
    events: readonly NewAgentSessionEvent[],
    retain: number,
  ): Promise<readonly AgentSessionEvent[]> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) throw new Error("Unknown PageAgentCLI attempt");
    const stored = this.events.get(attemptId) ?? [];
    let next = this.sequences.get(attemptId) ?? 1;
    const added: AgentSessionEvent[] = [];
    for (const event of events) {
      if (
        event.dedupeKey !== null &&
        stored.some((entry) => entry.dedupeKey === event.dedupeKey)
      )
        continue;
      const entry = {
        id: `${attemptId}:${next}`,
        sequence: next,
        stepId: attempt.key.stepId,
        attemptId,
        turn: event.turn,
        kind: event.kind,
        createdAt: event.createdAt,
        text: event.text,
        isTruncated: event.isTruncated,
      };
      stored.push({ ...entry, dedupeKey: event.dedupeKey });
      added.push(entry);
      next += 1;
    }
    this.sequences.set(attemptId, next);
    this.events.set(
      attemptId,
      stored.filter((entry) => entry.sequence >= next - retain),
    );
    return added;
  }

  /** Reads events after a sequence and the first retained one. */
  public async readEvents(
    attemptId: string,
    after: number,
    limit: number,
  ): Promise<StoredSessionEvents> {
    const stored = this.events.get(attemptId) ?? [];
    const oldest = stored[0]?.sequence ?? null;
    return {
      events: stored
        .filter((entry) => entry.sequence > after)
        .slice(0, limit)
        .map((entry) => ({
          id: entry.id,
          sequence: entry.sequence,
          stepId: entry.stepId,
          attemptId: entry.attemptId,
          turn: entry.turn,
          kind: entry.kind,
          createdAt: entry.createdAt,
          text: entry.text,
          isTruncated: entry.isTruncated,
        })),
      retainedFrom: oldest !== null && oldest > 1 ? oldest : null,
    };
  }

  /** Replaces the usage of the same attempt and turn. */
  public async saveTurnUsage(usage: AgentSessionTurnUsage): Promise<void> {
    this.usage.set(`${usage.attemptId}/${usage.turn}`, usage);
  }

  /** Reads the usage of every attempt of a run. */
  public async listRunUsage(
    runId: string,
  ): Promise<readonly AgentSessionTurnUsage[]> {
    return [...this.usage.values()].filter(
      (usage) => this.attempts.get(usage.attemptId)?.key.runId === runId,
    );
  }

  /** Stores an instruction. */
  public async saveMessage(message: AgentSessionMessage): Promise<void> {
    this.messages.set(message.id, message);
  }

  /** Changes a status only from an expected one. */
  public async updateMessage(
    id: string,
    from: readonly AgentSessionMessageStatus[],
    status: AgentSessionMessageStatus,
  ): Promise<boolean> {
    const message = this.messages.get(id);
    if (!message || !from.includes(message.status)) return false;
    this.messages.set(id, { ...message, status });
    return true;
  }

  /** Reads the instructions of an attempt in sending order. */
  public async listMessages(
    attemptId: string,
  ): Promise<readonly AgentSessionMessage[]> {
    return [...this.messages.values()].filter(
      (message) => message.attemptId === attemptId,
    );
  }

  /** Marks deliveries left on the way as uncertain. */
  public async markUncertainDeliveries(): Promise<number> {
    let changed = 0;
    for (const message of this.messages.values())
      if (message.status === "delivering") {
        this.messages.set(message.id, { ...message, status: "uncertain" });
        changed += 1;
      }
    return changed;
  }
}

/** A session record of an ACP node, as the step runner stores it. */
export function sessionRecord(
  overrides: Partial<AgentPlanSessionRecord> = {},
): AgentPlanSessionRecord {
  return {
    runner: "claude_code",
    mode: "interactive",
    instanceId: "instance-1",
    attemptId: "attempt-1",
    sessionId: "acp-session-1",
    processId: 4_000,
    startedAt: "2026-10-17T01:00:00.000Z",
    turnEndedAt: null,
    endedAt: null,
    exit: null,
    closeout: "pending",
    leftoverProcesses: null,
    resultCode: null,
    requested: {
      runner: "claude_code",
      connectionId: "connection",
      connectionName: "Claude",
      model: "claude-opus-5-5",
      reasoningEffort: "high",
      options: null,
      unattended: "plan mode",
      mcp: false,
      directory: "/workspace/repo",
    },
    effective: null,
    definition: null,
    contract: null,
    acceptance: null,
    events: [],
    ...overrides,
  };
}

/** A node of a run with its record. */
export function sessionStep(
  id: string,
  record: AgentPlanSessionRecord | null,
  overrides: Partial<AgentPlanStepResult> = {},
): AgentPlanStepResult {
  return {
    id,
    name: id,
    status: "running",
    isBlocked: false,
    cancellation: "none",
    output: null,
    error: null,
    session: record,
    ...overrides,
  };
}

/** A run of plan `plan-1` by `executor`. */
export function sessionRun(
  steps: readonly AgentPlanStepResult[],
  overrides: Partial<AgentPlanRun> = {},
): AgentPlanRun {
  return {
    id: "run-1",
    planId: "plan-1",
    planName: "Plan",
    planRevision: 1,
    userId: "executor",
    startedAt: "2026-10-17T01:00:00.000Z",
    status: "running",
    stopRequested: false,
    steps,
    ...overrides,
  };
}
