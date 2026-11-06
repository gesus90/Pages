import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import { requireAgentFiles } from "@/backend/storage/AgentPayloadFileStore";

import {
  appendSessionHistoryChunks,
  prepareSessionHistoryChunks,
  readSessionHistoryChunks,
} from "./AgentSessionHistoryChunks";
import { readStoredEventRow } from "./AgentSessionRows";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentSessionDatabase } from "./AgentSessionDatabase";
import type {
  NewAgentSessionEvent,
  StoredSessionEvents,
} from "@/backend/service/agents/sessions/AgentSessionStore";
import type {
  AgentSessionEvent,
  AgentSessionEventPage,
  AgentSessionHistoryWindow,
} from "@/definition/AgentSessionJournal";
import type { PreparedSessionChunk } from "./AgentSessionHistoryChunks";

interface PreparedEvent {
  readonly event: NewAgentSessionEvent;
  readonly bodyFile: string;
}

interface PreparedAppend {
  readonly attemptId: string;
  readonly next: number;
  readonly launchId: string;
  readonly stored: readonly AgentSessionEvent[];
  readonly events: readonly PreparedEvent[];
  readonly chunks: readonly PreparedSessionChunk[];
}

class SessionAppendConflict extends Error {}

/**
 * The stored form of the key that drops a repeated event.
 *
 * @remarks
 * PostgreSQL stores text without U+0000, and a key without the character would drop
 * the events of another key. Hex keeps such a key apart and repeatable.
 */
function storedDedupeKey(key: string): string {
  return key.includes("\u0000")
    ? `nul:${Buffer.from(key, "utf8").toString("hex")}`
    : key;
}

/** Numbered session events and their immutable file journal, sharing the original public contract. */
export class AgentSessionEventRepository {
  private readonly database: AgentSessionDatabase;
  private readonly writes = new SerialQueue();

  public constructor(database: AgentSessionDatabase) {
    this.database = database;
  }

  /** Prepares bytes without a transaction, then rechecks numbering/deduplication under the attempt lock. */
  public async appendEvents(
    attemptId: string,
    events: readonly NewAgentSessionEvent[],
    retain: number,
  ): Promise<readonly AgentSessionEvent[]> {
    return this.writes.run(async () => {
      for (let retry = 0; retry < 5; retry += 1) {
        const prepared = await this.prepare(attemptId, events);
        try {
          await this.database.transaction((transaction) =>
            this.publish(transaction, prepared, retain),
          );
          return prepared.stored;
        } catch (error: unknown) {
          if (!(error instanceof SessionAppendConflict)) throw error;
        }
      }
      throw new AgentError("plan_conflict");
    });
  }

  /** Reads events after a sequence, in order, and where retention cut the history. */
  public async readEvents(
    attemptId: string,
    after: number,
    limit: number,
  ): Promise<StoredSessionEvents> {
    const rows = await this.database.query(
      `
      SELECT
          agent_session_events.sequence,
          agent_session_events.turn,
          agent_session_events.kind,
          agent_session_events.body,
          agent_session_events.is_truncated,
          agent_session_events.created_at,
          agent_session_attempts.step_id,
          agent_session_events.body_file
      FROM agent_session_events
      INNER JOIN agent_session_attempts
          ON agent_session_attempts.attempt_id = agent_session_events.attempt_id
      WHERE agent_session_events.attempt_id = $attempt_id
          AND agent_session_events.sequence > $after
      ORDER BY agent_session_events.sequence
      LIMIT $limit;
    `,
      { attempt_id: attemptId, after, limit },
    );
    const [first] = await this.database.query(
      `
      SELECT MIN(sequence)
      FROM agent_session_events
      WHERE attempt_id = $attempt_id;
    `,
      { attempt_id: attemptId },
    );
    const oldest =
      first?.[0] === null || first?.[0] === undefined
        ? null
        : readCountColumn(first, 0, "sequence");
    return {
      events: await Promise.all(
        rows.map((row) => readStoredEventRow(this.database, row, attemptId)),
      ),
      retainedFrom: oldest !== null && oldest > 1 ? oldest : null,
    };
  }

  /** Reads the chunk journal, falling back to explicitly retained legacy rows without inventing older history. */
  public async readWindow(
    attemptId: string,
    window: AgentSessionHistoryWindow,
  ): Promise<AgentSessionEventPage> {
    const archived = await readSessionHistoryChunks(
      this.database,
      attemptId,
      window,
    );
    if (archived) return archived;
    const isBackward = window.tail === true || window.before !== undefined;
    const stored = await this.readEvents(
      attemptId,
      isBackward ? 0 : window.after,
      isBackward ? 2001 : window.limit + 1,
    );
    const eligible = stored.events.filter(
      (event) => window.before === undefined || event.sequence < window.before,
    );
    const events = isBackward
      ? eligible.slice(-window.limit)
      : eligible.slice(0, window.limit);
    return {
      events,
      cursor: events.at(-1)?.sequence ?? (window.after || null),
      hasMore: !isBackward && eligible.length > events.length,
      hasEarlier: (events[0]?.sequence ?? 0) > (stored.retainedFrom ?? 1),
      retainedFrom: stored.retainedFrom,
      source: "journal",
    };
  }

  private async prepare(
    attemptId: string,
    events: readonly NewAgentSessionEvent[],
  ): Promise<PreparedAppend> {
    const [attempt] = await this.database.query(
      `
      SELECT next_sequence, step_id, instance_id, plan_id
      FROM agent_session_attempts
      WHERE attempt_id = $attempt_id;
    `,
      { attempt_id: attemptId },
    );
    if (!attempt) throw new Error("Unknown PageAgentCLI attempt");
    const next = readCountColumn(attempt, 0, "next_sequence");
    const planId = readTextColumn(attempt, 3, "plan_id");
    const prepared: PreparedEvent[] = [];
    const stored: AgentSessionEvent[] = [];
    const keys = new Set<string>();
    for (const event of events) {
      if (
        event.dedupeKey !== null &&
        (keys.has(event.dedupeKey) ||
          (await this.isDuplicate(this.database, attemptId, event)))
      )
        continue;
      if (event.dedupeKey !== null) keys.add(event.dedupeKey);
      prepared.push({
        event,
        bodyFile: await requireAgentFiles(this.database).write(
          planId,
          event.text.replaceAll("\u0000", ""),
        ),
      });
      const sequence = next + stored.length;
      stored.push({
        id: `${attemptId}:${sequence}`,
        sequence,
        stepId: readTextColumn(attempt, 1, "step_id"),
        attemptId,
        turn: event.turn,
        kind: event.kind,
        createdAt: event.createdAt,
        text: event.text,
        isTruncated: event.isTruncated,
      });
    }
    return {
      attemptId,
      next,
      launchId: readTextColumn(attempt, 2, "instance_id"),
      stored,
      events: prepared,
      chunks: await prepareSessionHistoryChunks(this.database, planId, stored),
    };
  }

  private async publish(
    transaction: DatabaseTransaction,
    prepared: PreparedAppend,
    retain: number,
  ): Promise<void> {
    const { attemptId, next, events, stored, chunks, launchId } = prepared;
    const [attempt] = await transaction.query(
      `
      SELECT next_sequence, step_id, instance_id
      FROM agent_session_attempts
      WHERE attempt_id = $attempt_id
      FOR UPDATE;
    `,
      { attempt_id: attemptId },
    );
    if (!attempt) throw new Error("Unknown PageAgentCLI attempt");
    if (
      readCountColumn(attempt, 0, "next_sequence") !== next ||
      readTextColumn(attempt, 2, "instance_id") !== launchId
    )
      throw new SessionAppendConflict();
    for (const [index, entry] of events.entries()) {
      if (await this.isDuplicate(transaction, attemptId, entry.event))
        throw new SessionAppendConflict();
      await this.insertEvent(transaction, attemptId, next + index, entry);
    }
    await appendSessionHistoryChunks(
      transaction,
      { attemptId, launchId },
      stored,
      chunks,
    );
    await transaction.execute(
      `
      UPDATE agent_session_attempts
      SET next_sequence = $next_sequence
      WHERE attempt_id = $attempt_id;
    `,
      { attempt_id: attemptId, next_sequence: next + events.length },
    );
    await transaction.execute(
      `
      DELETE FROM agent_session_events
      WHERE attempt_id = $attempt_id
          AND sequence < $first_kept;
    `,
      { attempt_id: attemptId, first_kept: next + events.length - retain },
    );
  }

  private async isDuplicate(
    transaction: DatabaseTransaction,
    attemptId: string,
    event: NewAgentSessionEvent,
  ): Promise<boolean> {
    if (event.dedupeKey === null) return false;
    const [existing] = await transaction.query(
      `
      SELECT sequence
      FROM agent_session_events
      WHERE attempt_id = $attempt_id
          AND dedupe_key = $dedupe_key;
    `,
      {
        attempt_id: attemptId,
        dedupe_key: storedDedupeKey(event.dedupeKey),
      },
    );
    return existing !== undefined;
  }

  private async insertEvent(
    transaction: DatabaseTransaction,
    attemptId: string,
    sequence: number,
    prepared: PreparedEvent,
  ): Promise<void> {
    const { event, bodyFile } = prepared;
    await transaction.execute(
      `
      INSERT INTO agent_session_events (
          attempt_id,
          sequence,
          turn,
          kind,
          body,
          body_file,
          is_truncated,
          dedupe_key,
          created_at
      )
      VALUES (
          $attempt_id,
          $sequence,
          $turn,
          $kind,
          $body,
          $body_file,
          $is_truncated,
          $dedupe_key,
          $created_at
      );
    `,
      {
        attempt_id: attemptId,
        sequence,
        turn: event.turn,
        kind: event.kind,
        body: "",
        body_file: bodyFile,
        is_truncated: event.isTruncated,
        dedupe_key:
          event.dedupeKey === null ? null : storedDedupeKey(event.dedupeKey),
        created_at: event.createdAt,
      },
    );
  }
}
