import { randomUUID } from "node:crypto";

import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import {
  PLAN_SWARM_MEMORY_LIMITS,
  emptyPlanSwarmMemory,
} from "@/definition/AgentPlanSwarmMemory";

import {
  ENTRY_COLUMNS,
  MEMORY_TABLES,
  compactMemory,
  contradictionsOf,
  entryOf,
  keyParameters,
  publishMemoryEntry,
} from "./AgentPlanSwarmMemoryWrites";

import type { Database } from "@/backend/database/Database";
import type {
  AgentPlanSwarmMemoryEntry,
  AgentPlanSwarmMemoryRead,
  AgentPlanSwarmMemoryRejection,
  AgentPlanSwarmMemorySnapshot,
  AgentPlanSwarmMemoryView,
} from "@/definition/AgentPlanSwarmMemory";
import type {
  SwarmMemoryCompactOutcome,
  SwarmMemoryCompaction,
  SwarmMemoryDraft,
  SwarmMemoryKey,
  SwarmMemoryPublishOutcome,
} from "./AgentPlanSwarmMemoryWrites";

export type {
  SwarmMemoryCompactOutcome,
  SwarmMemoryCompaction,
  SwarmMemoryDraft,
  SwarmMemoryKey,
  SwarmMemoryPublishOutcome,
} from "./AgentPlanSwarmMemoryWrites";

/**
 * Stores the shared memory of the swarm nodes of a run.
 * @remarks
 * A publish locks the state row of its run and node, so two publishes never
 * take the same revision and a rolled back one leaves no gap: the counter
 * rises in the same transaction as the event. The event id makes a repeated
 * publish return the stored entry instead of a second one. Events are never
 * deleted while the run exists; a consolidation only marks them superseded.
 */
export class AgentPlanSwarmMemoryRepository {
  private readonly database: Pick<
    Database,
    "query" | "execute" | "transaction"
  >;

  public constructor(
    database: Pick<Database, "query" | "execute" | "transaction">,
  ) {
    this.database = database;
  }

  /** Creates the memory of a node if needed and stores whether it outlives the run. */
  public async configure(
    key: SwarmMemoryKey,
    keepAfterEnd: boolean,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_plan_swarm_memory_states (
          run_id,
          node_id,
          keep_after_end,
          updated_at
      )
      VALUES (
          $run_id,
          $node_id,
          $keep_after_end,
          $updated_at
      )
      ON CONFLICT (run_id, node_id) DO UPDATE SET
          keep_after_end = excluded.keep_after_end;
    `,
      {
        ...keyParameters(key),
        keep_after_end: keepAfterEnd ? 1 : 0,
        updated_at: new Date().toISOString(),
      },
    );
  }

  /**
   * Stores one entry with the next revision of its node.
   * @param draft - The checked entry.
   * @param limits - The most entries of the node and of its author; `null` for no author limit.
   */
  public async publish(
    draft: SwarmMemoryDraft,
    limits: { readonly node: number; readonly author: number | null },
  ): Promise<SwarmMemoryPublishOutcome> {
    return this.database.transaction((transaction) =>
      publishMemoryEntry(transaction, draft, limits),
    );
  }

  /** Keeps a refused entry for the activity view, at most {@link PLAN_SWARM_MEMORY_LIMITS.rejections} per node. */
  public async reject(
    key: SwarmMemoryKey,
    rejection: AgentPlanSwarmMemoryRejection,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_plan_swarm_memory_rejections (
          id,
          run_id,
          node_id,
          author,
          kind,
          body,
          reason,
          created_at
      )
      SELECT
          $id,
          $run_id,
          $node_id,
          $author,
          $kind,
          $body,
          $reason,
          $created_at
      WHERE (
          SELECT COUNT(*)
          FROM agent_plan_swarm_memory_rejections
          WHERE run_id = $run_id
              AND node_id = $node_id
      ) < $limit;
    `,
      {
        ...keyParameters(key),
        id: randomUUID(),
        author: rejection.author,
        kind: rejection.kind,
        body: rejection.text,
        reason: rejection.reason,
        created_at: rejection.createdAt,
        limit: PLAN_SWARM_MEMORY_LIMITS.rejections,
      },
    );
  }

  /** Replaces the snapshot when its version is still the expected one and marks entries superseded. */
  public async compact(
    compaction: SwarmMemoryCompaction,
  ): Promise<SwarmMemoryCompactOutcome> {
    return this.database.transaction((transaction) =>
      compactMemory(transaction, compaction),
    );
  }

  /** The newest revision and the snapshot of a node; an untouched node reads as empty. */
  public async state(key: SwarmMemoryKey): Promise<{
    readonly revision: number;
    readonly snapshot: AgentPlanSwarmMemorySnapshot;
  }> {
    const [row] = await this.database.query(
      `
      SELECT
          revision,
          snapshot_text,
          snapshot_revision,
          snapshot_version,
          snapshot_contradictions,
          snapshot_updated_at
      FROM agent_plan_swarm_memory_states
      WHERE run_id = $run_id
          AND node_id = $node_id;
    `,
      keyParameters(key),
    );
    if (!row) {
      const empty = emptyPlanSwarmMemory();
      return { revision: empty.revision, snapshot: empty.snapshot };
    }
    return {
      revision: readCountColumn(row, 0, "revision"),
      snapshot: {
        text: readTextColumn(row, 1, "snapshot_text"),
        revision: readCountColumn(row, 2, "snapshot_revision"),
        version: readCountColumn(row, 3, "snapshot_version"),
        contradictions: [
          ...contradictionsOf(
            readTextColumn(row, 4, "snapshot_contradictions"),
          ),
        ],
        updatedAt: readNullableTextColumn(row, 5, "snapshot_updated_at"),
      },
    };
  }

  /** The entries after a revision, oldest first, at most `limit`. */
  public async changes(
    key: SwarmMemoryKey,
    afterRevision: number,
    limit: number,
  ): Promise<readonly AgentPlanSwarmMemoryEntry[]> {
    const rows = await this.database.query(
      `
      SELECT ${ENTRY_COLUMNS}
      FROM agent_plan_swarm_memory_events
      WHERE run_id = $run_id
          AND node_id = $node_id
          AND revision > $after_revision
      ORDER BY revision
      LIMIT $limit;
    `,
      { ...keyParameters(key), after_revision: afterRevision, limit },
    );
    return rows.map(entryOf);
  }

  /** The newest entries after a revision, newest first, at most `limit`. */
  public async latest(
    key: SwarmMemoryKey,
    afterRevision: number,
    limit: number,
  ): Promise<readonly AgentPlanSwarmMemoryEntry[]> {
    const rows = await this.database.query(
      `
      SELECT ${ENTRY_COLUMNS}
      FROM agent_plan_swarm_memory_events
      WHERE run_id = $run_id
          AND node_id = $node_id
          AND revision > $after_revision
      ORDER BY revision DESC
      LIMIT $limit;
    `,
      { ...keyParameters(key), after_revision: afterRevision, limit },
    );
    return rows.map(entryOf);
  }

  /** Up to which revision an agent received the entries; 0 when never. */
  public async readRevision(
    key: SwarmMemoryKey,
    agentId: string,
  ): Promise<number> {
    const [row] = await this.database.query(
      `
      SELECT revision
      FROM agent_plan_swarm_memory_reads
      WHERE run_id = $run_id
          AND node_id = $node_id
          AND agent_id = $agent_id;
    `,
      { ...keyParameters(key), agent_id: agentId },
    );
    return row ? readCountColumn(row, 0, "revision") : 0;
  }

  /** Records that an agent received the entries up to a revision; it never goes back. */
  public async markRead(
    key: SwarmMemoryKey,
    agentId: string,
    revision: number,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_plan_swarm_memory_reads (
          run_id,
          node_id,
          agent_id,
          revision,
          updated_at
      )
      VALUES (
          $run_id,
          $node_id,
          $agent_id,
          $revision,
          $updated_at
      )
      ON CONFLICT (run_id, node_id, agent_id) DO UPDATE SET
          revision = GREATEST(
              agent_plan_swarm_memory_reads.revision,
              excluded.revision
          ),
          updated_at = excluded.updated_at;
    `,
      {
        ...keyParameters(key),
        agent_id: agentId,
        revision,
        updated_at: new Date().toISOString(),
      },
    );
  }

  /** The whole memory of a node, as the run view and the export read it. */
  public async view(key: SwarmMemoryKey): Promise<AgentPlanSwarmMemoryView> {
    const state = await this.state(key);
    const entries = await this.changes(
      key,
      0,
      PLAN_SWARM_MEMORY_LIMITS.nodeEntries,
    );
    return {
      revision: state.revision,
      snapshot: state.snapshot,
      entries: [...entries],
      rejections: [...(await this.rejections(key))],
      reads: [...(await this.reads(key))],
    };
  }

  /**
   * Moves the memory of the run a resume continues to the new run.
   * @returns Whether anything was moved; a run that has its own memory keeps it.
   */
  public async adopt(
    fromRunId: string,
    toRunId: string,
    nodeId: string,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [own] = await transaction.query(
        `
          SELECT run_id
          FROM agent_plan_swarm_memory_states
          WHERE run_id = $run_id
              AND node_id = $node_id;
        `,
        { run_id: toRunId, node_id: nodeId },
      );
      if (own) return false;
      for (const table of MEMORY_TABLES)
        await transaction.execute(
          `
            UPDATE ${table}
            SET run_id = $to_run_id
            WHERE run_id = $from_run_id
                AND node_id = $node_id;
          `,
          { from_run_id: fromRunId, to_run_id: toRunId, node_id: nodeId },
        );
      return true;
    });
  }

  /** Deletes the memory of every node of a run that should not outlive it. */
  public async discardUnkept(runId: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      for (const table of MEMORY_TABLES)
        await transaction.execute(
          `
            DELETE FROM ${table}
            WHERE run_id = $run_id
                AND node_id IN (
                    SELECT node_id
                    FROM agent_plan_swarm_memory_states
                    WHERE run_id = $run_id
                        AND keep_after_end = 0
                );
          `,
          { run_id: runId },
        );
    });
  }

  private async rejections(
    key: SwarmMemoryKey,
  ): Promise<readonly AgentPlanSwarmMemoryRejection[]> {
    const rows = await this.database.query(
      `
      SELECT
          author,
          kind,
          body,
          reason,
          created_at
      FROM agent_plan_swarm_memory_rejections
      WHERE run_id = $run_id
          AND node_id = $node_id
      ORDER BY created_at, id
      LIMIT $limit;
    `,
      { ...keyParameters(key), limit: PLAN_SWARM_MEMORY_LIMITS.rejections },
    );
    return rows.map((row) => ({
      author: readTextColumn(row, 0, "author"),
      kind: readTextColumn(row, 1, "kind"),
      text: readTextColumn(row, 2, "body"),
      reason: readTextColumn(row, 3, "reason"),
      createdAt: readTextColumn(row, 4, "created_at"),
    }));
  }

  private async reads(
    key: SwarmMemoryKey,
  ): Promise<readonly AgentPlanSwarmMemoryRead[]> {
    const rows = await this.database.query(
      `
      SELECT
          agent_id,
          revision
      FROM agent_plan_swarm_memory_reads
      WHERE run_id = $run_id
          AND node_id = $node_id
      ORDER BY agent_id;
    `,
      keyParameters(key),
    );
    return rows.map((row) => ({
      agent: readTextColumn(row, 0, "agent_id"),
      revision: readCountColumn(row, 1, "revision"),
    }));
  }
}
