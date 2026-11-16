import {
  readCountColumn,
  readBooleanColumn,
  readNullableCountColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { PLAN_SWARM_MEMORY_KINDS } from "@/definition/AgentPlanSwarmMemory";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type {
  AgentPlanSwarmMemoryEntry,
  AgentPlanSwarmMemoryKind,
  AgentPlanSwarmMemorySnapshot,
} from "@/definition/AgentPlanSwarmMemory";

/** The run and node one memory belongs to. */
export interface SwarmMemoryKey {
  readonly runId: string;
  readonly nodeId: string;
}

/** One entry to store; its text is already blacked out and checked. */
export interface SwarmMemoryDraft extends SwarmMemoryKey {
  readonly eventId: string;
  readonly author: string;
  readonly kind: AgentPlanSwarmMemoryKind;
  readonly text: string;
  readonly isRedacted: boolean;
  readonly createdAt: string;
}

/** How a publish ended; only `published` took a new revision. */
export type SwarmMemoryPublishOutcome =
  | {
      readonly status: "published" | "duplicate";
      readonly entry: AgentPlanSwarmMemoryEntry;
    }
  | { readonly status: "event_conflict" }
  | {
      readonly status: "node_limit" | "worker_limit";
      readonly limit: number;
    };

/** A consolidation of the main model. */
export interface SwarmMemoryCompaction extends SwarmMemoryKey {
  readonly expectedVersion: number;
  readonly text: string;
  readonly contradictions: readonly string[];
  readonly supersede: readonly number[];
  readonly updatedAt: string;
}

/** How a consolidation ended. */
export type SwarmMemoryCompactOutcome =
  | {
      readonly status: "compacted";
      readonly snapshot: AgentPlanSwarmMemorySnapshot;
      readonly superseded: readonly number[];
    }
  | { readonly status: "version_conflict"; readonly version: number };

/** Every table of the shared memory, the state table last. */
export const MEMORY_TABLES = [
  "agent_plan_swarm_memory_events",
  "agent_plan_swarm_memory_reads",
  "agent_plan_swarm_memory_rejections",
  "agent_plan_swarm_memory_states",
] as const;

/** The columns of one entry in the order {@link entryOf} reads them. */
export const ENTRY_COLUMNS = `
    revision,
    event_id,
    author,
    kind,
    body,
    is_redacted,
    superseded_by,
    created_at`;

const ENSURE_STATE = `
  INSERT INTO agent_plan_swarm_memory_states (
      run_id,
      node_id,
      updated_at
  )
  VALUES (
      $run_id,
      $node_id,
      $updated_at
  )
  ON CONFLICT (run_id, node_id) DO NOTHING;
`;

const LOCK_STATE = `
  SELECT
      revision,
      snapshot_version
  FROM agent_plan_swarm_memory_states
  WHERE run_id = $run_id
      AND node_id = $node_id
  FOR UPDATE;
`;

function kindOf(value: string): AgentPlanSwarmMemoryKind {
  const kind = PLAN_SWARM_MEMORY_KINDS.find((entry) => entry === value);
  if (!kind) throw new Error(`Unknown swarm memory kind "${value}".`);
  return kind;
}

/** Reads one entry from a row of {@link ENTRY_COLUMNS}. */
export function entryOf(
  row: readonly DatabaseValue[],
): AgentPlanSwarmMemoryEntry {
  return {
    revision: readCountColumn(row, 0, "revision"),
    eventId: readTextColumn(row, 1, "event_id"),
    author: readTextColumn(row, 2, "author"),
    kind: kindOf(readTextColumn(row, 3, "kind")),
    text: readTextColumn(row, 4, "body"),
    isRedacted: readBooleanColumn(row, 5, "is_redacted"),
    supersededBy: readNullableCountColumn(row, 6, "superseded_by"),
    createdAt: readTextColumn(row, 7, "created_at"),
  };
}

/** Reads the stored JSON list of open contradictions; anything else reads as none. */
export function contradictionsOf(stored: string): readonly string[] {
  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is string => typeof entry === "string");
}

/** The run and node as SQL parameters. */
export function keyParameters(key: SwarmMemoryKey): {
  readonly run_id: string;
  readonly node_id: string;
} {
  return { run_id: key.runId, node_id: key.nodeId };
}

async function lockState(
  transaction: DatabaseTransaction,
  key: SwarmMemoryKey,
  updatedAt: string,
): Promise<{ readonly revision: number; readonly version: number }> {
  await transaction.execute(ENSURE_STATE, {
    ...keyParameters(key),
    updated_at: updatedAt,
  });
  const [row] = await transaction.query(LOCK_STATE, keyParameters(key));
  if (!row) throw new Error("Swarm memory state is missing.");
  return {
    revision: readCountColumn(row, 0, "revision"),
    version: readCountColumn(row, 1, "snapshot_version"),
  };
}

async function existingEvent(
  transaction: DatabaseTransaction,
  draft: SwarmMemoryDraft,
): Promise<AgentPlanSwarmMemoryEntry | null> {
  const [row] = await transaction.query(
    `
      SELECT ${ENTRY_COLUMNS}
      FROM agent_plan_swarm_memory_events
      WHERE run_id = $run_id
          AND node_id = $node_id
          AND event_id = $event_id;
    `,
    { ...keyParameters(draft), event_id: draft.eventId },
  );
  return row ? entryOf(row) : null;
}

async function entryCounts(
  transaction: DatabaseTransaction,
  draft: SwarmMemoryDraft,
): Promise<{ readonly node: number; readonly author: number }> {
  const [row] = await transaction.query(
    `
      SELECT
          COUNT(*) AS node_entries,
          COUNT(*) FILTER (WHERE author = $author) AS author_entries
      FROM agent_plan_swarm_memory_events
      WHERE run_id = $run_id
          AND node_id = $node_id;
    `,
    { ...keyParameters(draft), author: draft.author },
  );
  return {
    node: row ? readCountColumn(row, 0, "node_entries") : 0,
    author: row ? readCountColumn(row, 1, "author_entries") : 0,
  };
}

function isSameEntry(
  stored: AgentPlanSwarmMemoryEntry,
  draft: SwarmMemoryDraft,
): boolean {
  return (
    stored.author === draft.author &&
    stored.kind === draft.kind &&
    stored.text === draft.text
  );
}

async function insertEvent(
  transaction: DatabaseTransaction,
  draft: SwarmMemoryDraft,
  revision: number,
): Promise<void> {
  await transaction.execute(
    `
      INSERT INTO agent_plan_swarm_memory_events (
          run_id,
          node_id,
          revision,
          event_id,
          author,
          kind,
          body,
          is_redacted,
          created_at
      )
      VALUES (
          $run_id,
          $node_id,
          $revision,
          $event_id,
          $author,
          $kind,
          $body,
          $is_redacted,
          $created_at
      );
    `,
    {
      ...keyParameters(draft),
      revision,
      event_id: draft.eventId,
      author: draft.author,
      kind: draft.kind,
      body: draft.text,
      is_redacted: draft.isRedacted ? 1 : 0,
      created_at: draft.createdAt,
    },
  );
  await transaction.execute(
    `
      UPDATE agent_plan_swarm_memory_states
      SET
          revision = $revision,
          updated_at = $updated_at
      WHERE run_id = $run_id
          AND node_id = $node_id;
    `,
    { ...keyParameters(draft), revision, updated_at: draft.createdAt },
  );
}

/**
 * Stores one entry with the next revision of its node inside an open transaction.
 * @remarks
 * The state row is locked first, so concurrent publishes of the node wait for
 * each other and every revision is given out once and without gaps.
 */
export async function publishMemoryEntry(
  transaction: DatabaseTransaction,
  draft: SwarmMemoryDraft,
  limits: { readonly node: number; readonly author: number | null },
): Promise<SwarmMemoryPublishOutcome> {
  const state = await lockState(transaction, draft, draft.createdAt);
  const existing = await existingEvent(transaction, draft);
  if (existing)
    return isSameEntry(existing, draft)
      ? { status: "duplicate", entry: existing }
      : { status: "event_conflict" };
  const counts = await entryCounts(transaction, draft);
  if (counts.node >= limits.node)
    return { status: "node_limit", limit: limits.node };
  if (limits.author !== null && counts.author >= limits.author)
    return { status: "worker_limit", limit: limits.author };
  const revision = state.revision + 1;
  await insertEvent(transaction, draft, revision);
  return {
    status: "published",
    entry: {
      revision,
      eventId: draft.eventId,
      author: draft.author,
      kind: draft.kind,
      text: draft.text,
      isRedacted: draft.isRedacted,
      supersededBy: null,
      createdAt: draft.createdAt,
    },
  };
}

async function supersede(
  transaction: DatabaseTransaction,
  compaction: SwarmMemoryCompaction,
  version: number,
): Promise<readonly number[]> {
  const superseded = [...new Set(compaction.supersede)];
  for (const revision of superseded)
    await transaction.execute(
      `
        UPDATE agent_plan_swarm_memory_events
        SET superseded_by = $version
        WHERE run_id = $run_id
            AND node_id = $node_id
            AND revision = $revision
            AND superseded_by IS NULL;
      `,
      { ...keyParameters(compaction), version, revision },
    );
  return superseded;
}

/** Replaces the snapshot inside an open transaction when its version is still the expected one. */
export async function compactMemory(
  transaction: DatabaseTransaction,
  compaction: SwarmMemoryCompaction,
): Promise<SwarmMemoryCompactOutcome> {
  const state = await lockState(transaction, compaction, compaction.updatedAt);
  if (state.version !== compaction.expectedVersion)
    return { status: "version_conflict", version: state.version };
  const version = state.version + 1;
  await transaction.execute(
    `
      UPDATE agent_plan_swarm_memory_states
      SET
          snapshot_text = $snapshot_text,
          snapshot_revision = revision,
          snapshot_version = $snapshot_version,
          snapshot_contradictions = $snapshot_contradictions,
          snapshot_updated_at = $updated_at,
          updated_at = $updated_at
      WHERE run_id = $run_id
          AND node_id = $node_id;
    `,
    {
      ...keyParameters(compaction),
      snapshot_text: compaction.text,
      snapshot_version: version,
      snapshot_contradictions: JSON.stringify(compaction.contradictions),
      updated_at: compaction.updatedAt,
    },
  );
  const superseded = await supersede(transaction, compaction, version);
  return {
    status: "compacted",
    snapshot: {
      text: compaction.text,
      revision: state.revision,
      version,
      contradictions: [...compaction.contradictions],
      updatedAt: compaction.updatedAt,
    },
    superseded,
  };
}
