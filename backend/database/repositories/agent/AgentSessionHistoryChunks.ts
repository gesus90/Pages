import { createHash } from "node:crypto";

import {
  readAgentPayload,
  requireAgentFiles,
} from "@/backend/storage/AgentPayloadFileStore";

import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { agentSessionEventSchema } from "@/definition/AgentSessionHistory";
import { AgentError } from "@/backend/error/AgentErrors";

import { readStoredEventRow } from "./AgentSessionRows";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type {
  AgentSessionEvent,
  AgentSessionEventPage,
  AgentSessionHistoryWindow,
} from "@/definition/AgentSessionJournal";

const CHUNK_BYTES = 4_194_304;
const CHUNK_COLUMNS =
  "launch_id, chunk_index, byte_offset, byte_length, first_sequence, last_sequence, sha256, previous_sha256, events_jsonl, events_file";

interface HistoryChunk {
  readonly attemptId: string;
  readonly launchId: string;
  readonly index: number;
  readonly offset: number;
  readonly bytes: number;
  readonly first: number;
  readonly last: number;
  readonly digest: string;
  readonly previous: string | null;
  readonly contents: string;
  readonly reference?: string;
}

function chunkDigest(chunk: Omit<HistoryChunk, "digest">): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        chunk.attemptId,
        chunk.launchId,
        chunk.index,
        chunk.offset,
        chunk.first,
        chunk.last,
        chunk.previous,
        chunk.contents,
      ]),
    )
    .digest("hex");
}

async function readChunk(
  transaction: DatabaseTransaction,
  row: readonly DatabaseValue[],
  attemptId: string,
): Promise<HistoryChunk> {
  const chunk: HistoryChunk = {
    attemptId,
    launchId: readTextColumn(row, 0, "launch_id"),
    index: readCountColumn(row, 1, "chunk_index"),
    offset: readCountColumn(row, 2, "byte_offset"),
    bytes: readCountColumn(row, 3, "byte_length"),
    first: readCountColumn(row, 4, "first_sequence"),
    last: readCountColumn(row, 5, "last_sequence"),
    digest: readTextColumn(row, 6, "sha256"),
    previous: readNullableTextColumn(row, 7, "previous_sha256"),
    contents: await readAgentPayload(
      transaction,
      readTextColumn(row, 8, "events_jsonl"),
      readNullableTextColumn(row, 9, "events_file"),
    ),
  };
  if (
    chunk.bytes > CHUNK_BYTES ||
    Buffer.byteLength(chunk.contents) !== chunk.bytes ||
    chunkDigest(chunk) !== chunk.digest
  )
    throw new AgentError("plan_history_corrupt");
  return chunk;
}

/** A complete immutable chunk synchronized before its reference transaction. */
export interface PreparedSessionChunk {
  readonly contents: string;
  readonly reference: string;
  readonly bytes: number;
  readonly first: number;
  readonly last: number;
}

/** Serializes validated events into bounded files without holding a database transaction. */
export async function prepareSessionHistoryChunks(
  access: DatabaseTransaction,
  planId: string,
  events: readonly AgentSessionEvent[],
): Promise<readonly PreparedSessionChunk[]> {
  const chunks: PreparedSessionChunk[] = [];
  let contents = "";
  let bytes = 0;
  let first = 0;
  let last = 0;
  for (const event of events) {
    const line = `${JSON.stringify(agentSessionEventSchema.parse(event))}\n`;
    const lineBytes = Buffer.byteLength(line);
    if (lineBytes > CHUNK_BYTES)
      throw new Error("Session history event too large");
    if (contents && bytes + lineBytes > CHUNK_BYTES) {
      chunks.push({
        contents,
        first,
        last,
        bytes,
        reference: await requireAgentFiles(access).write(planId, contents),
      });
      contents = "";
      bytes = 0;
      first = 0;
    }
    first ||= event.sequence;
    last = event.sequence;
    contents += line;
    bytes += lineBytes;
  }
  if (contents)
    chunks.push({
      contents,
      first,
      last,
      bytes,
      reference: await requireAgentFiles(access).write(planId, contents),
    });
  return chunks;
}

async function persistChunk(
  transaction: DatabaseTransaction,
  chunk: HistoryChunk,
): Promise<void> {
  if (!chunk.reference) throw new Error("Prepared history file missing.");
  await transaction.execute(
    `
    INSERT INTO agent_session_history_chunks (
        attempt_id, launch_id, chunk_index, byte_offset, byte_length,
        first_sequence, last_sequence, sha256, previous_sha256, events_jsonl, events_file
    ) VALUES (
        $attempt_id, $launch_id, $chunk_index, $byte_offset, $byte_length,
        $first_sequence, $last_sequence, $sha256, $previous_sha256, $events_jsonl, $events_file
    )
    ;
  `,
    {
      attempt_id: chunk.attemptId,
      launch_id: chunk.launchId,
      chunk_index: chunk.index,
      byte_offset: chunk.offset,
      byte_length: chunk.bytes,
      first_sequence: chunk.first,
      last_sequence: chunk.last,
      sha256: chunkDigest(chunk),
      previous_sha256: chunk.previous,
      events_jsonl: "",
      events_file: chunk.reference,
    },
  );
}

function requirePreparedHistory(
  events: readonly AgentSessionEvent[],
  prepared: readonly PreparedSessionChunk[],
): void {
  if (
    !prepared.length ||
    prepared[0]?.first !== events[0]?.sequence ||
    prepared.at(-1)?.last !== events.at(-1)?.sequence
  )
    throw new Error(
      "Session history must be synchronized before its transaction.",
    );
}

/** Publishes only prepared immutable chunks with their chain index in the receipt transaction. */
export async function appendSessionHistoryChunks(
  transaction: DatabaseTransaction,
  owner: { readonly attemptId: string; readonly launchId: string },
  events: readonly AgentSessionEvent[],
  prepared: readonly PreparedSessionChunk[] = [],
): Promise<void> {
  if (!events.length) return;
  requirePreparedHistory(events, prepared);
  const [row] = await transaction.query(
    `
    SELECT ${CHUNK_COLUMNS}
    FROM agent_session_history_chunks
    WHERE attempt_id = $attempt_id
    ORDER BY chunk_index DESC
    LIMIT 1;
  `,
    { attempt_id: owner.attemptId },
  );
  let index = row ? readCountColumn(row, 1, "chunk_index") : 0;
  let offset = row
    ? readCountColumn(row, 2, "byte_offset") +
      readCountColumn(row, 3, "byte_length")
    : 0;
  let previous = row ? readTextColumn(row, 6, "sha256") : null;
  let last = row
    ? readCountColumn(row, 5, "last_sequence")
    : (events[0]?.sequence ?? 1) - 1;
  if (row && readTextColumn(row, 0, "launch_id") !== owner.launchId)
    throw new Error("Session history launch changed");
  for (const part of prepared) {
    if (part.first !== last + 1)
      throw new Error("Session history event out of sequence");
    const chunk: HistoryChunk = {
      ...part,
      attemptId: owner.attemptId,
      launchId: owner.launchId,
      index: ++index,
      offset,
      previous,
      digest: "",
    };
    await persistChunk(transaction, chunk);
    previous = chunkDigest(chunk);
    offset += chunk.bytes;
    last = chunk.last;
  }
}

async function readExistingPrefix(
  transaction: DatabaseTransaction,
  attemptId: string,
  before: number,
): Promise<readonly AgentSessionEvent[]> {
  if (before === 1) return [];
  const rows = await transaction.query(
    `
    SELECT
        agent_session_events.sequence, agent_session_events.turn, agent_session_events.kind,
        agent_session_events.body, agent_session_events.is_truncated, agent_session_events.created_at,
        agent_session_attempts.step_id, agent_session_events.body_file
    FROM agent_session_events
    INNER JOIN agent_session_attempts
        ON agent_session_attempts.attempt_id = agent_session_events.attempt_id
    WHERE agent_session_events.attempt_id = $attempt_id
        AND agent_session_events.sequence < $before
    ORDER BY agent_session_events.sequence
    LIMIT 2000;
  `,
    { attempt_id: attemptId, before },
  );
  return Promise.all(
    rows.map((row) => readStoredEventRow(transaction, row, attemptId)),
  );
}

function chunkEvents(chunk: HistoryChunk): readonly AgentSessionEvent[] {
  const events: AgentSessionEvent[] = [];
  let sequence = chunk.first;
  for (const line of chunk.contents.trimEnd().split("\n")) {
    const parsed: unknown = JSON.parse(line);
    const event = agentSessionEventSchema.parse(parsed);
    if (event.attemptId !== chunk.attemptId || event.sequence !== sequence)
      throw new AgentError("plan_history_corrupt");
    sequence += 1;
    events.push(event);
  }
  if (sequence - 1 !== chunk.last) throw new AgentError("plan_history_corrupt");
  return events;
}

async function requireChunkLink(
  transaction: DatabaseTransaction,
  chunk: HistoryChunk,
): Promise<void> {
  if (chunk.index === 1) {
    if (chunk.previous !== null || chunk.offset !== 0)
      throw new AgentError("plan_history_corrupt");
    return;
  }
  const [previous] = await transaction.query(
    `
    SELECT sha256, byte_offset + byte_length, last_sequence, launch_id
    FROM agent_session_history_chunks
    WHERE attempt_id = $attempt_id
        AND chunk_index = $chunk_index;
  `,
    { attempt_id: chunk.attemptId, chunk_index: chunk.index - 1 },
  );
  if (
    !previous ||
    readTextColumn(previous, 0, "sha256") !== chunk.previous ||
    readCountColumn(previous, 1, "end_offset") !== chunk.offset ||
    readCountColumn(previous, 2, "last_sequence") + 1 !== chunk.first ||
    readTextColumn(previous, 3, "launch_id") !== chunk.launchId
  )
    throw new AgentError("plan_history_corrupt");
}

/** Reads a bounded event window from immutable chunks, including retained legacy prefixes. */
export async function readSessionHistoryChunks(
  transaction: DatabaseTransaction,
  attemptId: string,
  window: AgentSessionHistoryWindow,
): Promise<AgentSessionEventPage | null> {
  const [bounds] = await transaction.query(
    `
    SELECT MIN(first_sequence), MAX(last_sequence)
    FROM agent_session_history_chunks
    WHERE attempt_id = $attempt_id;
  `,
    { attempt_id: attemptId },
  );
  if (!bounds || bounds[0] === null) return null;
  const chunkFirst = readCountColumn(bounds, 0, "first_sequence");
  const prefix =
    chunkFirst > 1
      ? await readExistingPrefix(transaction, attemptId, chunkFirst)
      : [];
  const first = prefix[0]?.sequence ?? chunkFirst;
  const last = readCountColumn(bounds, 1, "last_sequence");
  if (
    window.after > last ||
    (window.before !== undefined && window.before > last + 1)
  )
    throw new AgentError("plan_invalid");
  const isBackward = window.tail === true || window.before !== undefined;
  const filter = isBackward
    ? "first_sequence < $cursor"
    : "last_sequence > $cursor";
  const order = isBackward ? "DESC" : "ASC";
  const cursor = isBackward ? (window.before ?? last + 1) : window.after;
  const events = await readHistoryWindow(transaction, attemptId, {
    isBackward,
    filter,
    order,
    cursor,
    limit: window.limit,
  });
  const candidates = [
    ...prefix.filter((event) =>
      isBackward ? event.sequence < cursor : event.sequence > cursor,
    ),
    ...events,
  ];
  const selected = isBackward
    ? candidates.slice(-window.limit)
    : candidates.slice(0, window.limit);
  return historyPage(selected, { first, last }, window.after);
}

function historyPage(
  events: readonly AgentSessionEvent[],
  bounds: { readonly first: number; readonly last: number },
  after: number,
): AgentSessionEventPage {
  const end = events.at(-1)?.sequence ?? after;
  return {
    events,
    cursor: end || null,
    hasMore: end < bounds.last,
    hasEarlier: (events[0]?.sequence ?? bounds.first) > bounds.first,
    retainedFrom: bounds.first > 1 ? bounds.first : null,
    source: "journal",
  };
}

async function readHistoryWindow(
  transaction: DatabaseTransaction,
  attemptId: string,
  query: {
    readonly isBackward: boolean;
    readonly filter: string;
    readonly order: string;
    readonly cursor: number;
    readonly limit: number;
  },
): Promise<readonly AgentSessionEvent[]> {
  const rows = await transaction.query(
    `
    SELECT ${CHUNK_COLUMNS}
    FROM agent_session_history_chunks
    WHERE attempt_id = $attempt_id
        AND ${query.filter}
    ORDER BY chunk_index ${query.order}
    LIMIT $chunk_limit;
  `,
    {
      attempt_id: attemptId,
      cursor: query.cursor,
      chunk_limit: query.limit + 1,
    },
  );
  const candidates: AgentSessionEvent[] = [];
  for (const row of rows) {
    const chunk = await readChunk(transaction, row, attemptId);
    await requireChunkLink(transaction, chunk);
    const entries = chunkEvents(chunk).filter((event) =>
      query.isBackward
        ? event.sequence < query.cursor
        : event.sequence > query.cursor,
    );
    if (query.isBackward) candidates.unshift(...entries.slice(-query.limit));
    else candidates.push(...entries.slice(0, query.limit));
    if (candidates.length >= query.limit) break;
  }
  return query.isBackward
    ? candidates.slice(-query.limit)
    : candidates.slice(0, query.limit);
}
