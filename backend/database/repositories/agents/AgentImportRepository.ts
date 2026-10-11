import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type {
  AgentImportCounts,
  AgentImportItem,
} from "@/definition/AgentImportApply";
import type { AgentStructuredImportItem } from "@/definition/AgentStructuredImportManifest";

/** A stored outcome: a wiki source of A9.8, or a source of any kind of A9.12. */
export type StoredAgentImportItem = AgentImportItem | AgentStructuredImportItem;

/** Server-owned accepted plan and run identity; source input stays in the operation fingerprint. */
export interface StoredAgentImportRun {
  readonly id: string;
  readonly userId: string;
  readonly projectId: string;
  readonly status: string;
  readonly snapshotJson: string;
}

/** Last imported target state, reserved by the project/source composite primary key. */
export interface StoredAgentImportSource {
  readonly projectId: string;
  readonly sourceKey: string;
  readonly targetKind: string;
  readonly targetId: string;
  readonly contentHash: string;
  readonly targetRevision: number;
  readonly resultJson: string;
  readonly lastRunId: string;
}

/** Persists resumable import runs and source outcomes on the caller's transaction connection. */
export class AgentImportRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Creates the durable run before any source is applied. */
  public async insertRun(run: StoredAgentImportRun): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO agent_import_runs (
            id,
            user_id,
            project_id,
            status,
            snapshot_json,
            created_at,
            updated_at
        )
        VALUES ($id, $user_id, $project_id, 'running', $snapshot_json, $now, $now);
      `,
      {
        id: run.id,
        user_id: run.userId,
        project_id: run.projectId,
        snapshot_json: run.snapshotJson,
        now: Date.now(),
      },
    );
  }

  /** Finds a run only within its authenticated owner and explicit project. */
  public async findRun(
    id: string,
    userId: string,
    projectId: string,
  ): Promise<StoredAgentImportRun | null> {
    const [row] = await this.database.query(
      `
        SELECT
            status,
            snapshot_json
        FROM agent_import_runs
        WHERE id = $id
            AND user_id = $user_id
            AND project_id = $project_id;
      `,
      { id, user_id: userId, project_id: projectId },
    );
    return row
      ? {
          id,
          userId,
          projectId,
          status: readTextColumn(row, 0, "status"),
          snapshotJson: readTextColumn(row, 1, "snapshot_json"),
        }
      : null;
  }

  /** Looks up a mapping without granting access to its target. */
  public async findSource(
    projectId: string,
    sourceKey: string,
  ): Promise<StoredAgentImportSource | null> {
    const [row] = await this.database.query(
      `
        SELECT
            target_kind,
            target_id,
            content_hash,
            target_revision,
            result_json,
            last_run_id
        FROM agent_import_sources
        WHERE project_id = $project_id
            AND source_key = $source_key;
      `,
      { project_id: projectId, source_key: sourceKey },
    );
    return row
      ? {
          projectId,
          sourceKey,
          targetKind: readTextColumn(row, 0, "target_kind"),
          targetId: readTextColumn(row, 1, "target_id"),
          contentHash: readTextColumn(row, 2, "content_hash"),
          targetRevision: readCountColumn(row, 3, "target_revision"),
          resultJson: readTextColumn(row, 4, "result_json"),
          lastRunId: readTextColumn(row, 5, "last_run_id"),
        }
      : null;
  }

  /** Registers a new source in the same commit as its page and attachments. */
  public async insertSource(source: StoredAgentImportSource): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO agent_import_sources (
            project_id,
            source_key,
            target_kind,
            target_id,
            content_hash,
            target_revision,
            result_json,
            last_run_id,
            created_at,
            updated_at
        )
        VALUES (
            $project_id, $source_key, $target_kind, $target_id, $content_hash,
            $target_revision, $result_json, $last_run_id, $now, $now
        );
      `,
      {
        project_id: source.projectId,
        source_key: source.sourceKey,
        target_kind: source.targetKind,
        target_id: source.targetId,
        content_hash: source.contentHash,
        target_revision: source.targetRevision,
        result_json: source.resultJson,
        last_run_id: source.lastRunId,
        now: Date.now(),
      },
    );
  }

  /** Moves the baseline to the page state an update wrote or verified as equal to its source. */
  public async refreshSource(
    source: Pick<
      StoredAgentImportSource,
      "projectId" | "sourceKey" | "contentHash" | "targetRevision" | "lastRunId"
    >,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_import_sources
        SET content_hash = $content_hash,
            target_revision = $target_revision,
            last_run_id = $last_run_id,
            updated_at = $now
        WHERE project_id = $project_id
            AND source_key = $source_key;
      `,
      {
        project_id: source.projectId,
        source_key: source.sourceKey,
        content_hash: source.contentHash,
        target_revision: source.targetRevision,
        last_run_id: source.lastRunId,
        now: Date.now(),
      },
    );
  }

  /** Records the last successful unchanged import without changing its baseline. */
  public async touchSource(
    projectId: string,
    sourceKey: string,
    runId: string,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_import_sources
        SET last_run_id = $run_id,
            updated_at = $now
        WHERE project_id = $project_id
            AND source_key = $source_key;
      `,
      {
        project_id: projectId,
        source_key: sourceKey,
        run_id: runId,
        now: Date.now(),
      },
    );
  }

  /** Returns the exact committed item when competing workers resume the same run. */
  public async findItem(
    runId: string,
    sourceKey: string,
  ): Promise<AgentImportItem | null> {
    const [row] = await this.database.query(
      `
        SELECT result_json
        FROM agent_import_items
        WHERE run_id = $run_id
            AND source_key = $source_key;
      `,
      { run_id: runId, source_key: sourceKey },
    );
    // Only recordItem writes this JSON, with the public item schema.
    return row
      ? (JSON.parse(readTextColumn(row, 0, "result_json")) as AgentImportItem)
      : null;
  }

  /** Saves an outcome and updates durable counters within the same source transaction. */
  public async recordItem(
    runId: string,
    ordinal: number,
    item: AgentImportItem,
  ): Promise<void> {
    await this.insertItem(
      runId,
      ordinal,
      { ...item, targetId: item.pageId },
      JSON.stringify(item),
    );
  }

  /** Saves the outcome of a source of a structured import, whatever its kind. */
  public async recordStructuredItem(
    runId: string,
    ordinal: number,
    item: AgentStructuredImportItem,
  ): Promise<void> {
    await this.insertItem(runId, ordinal, item, JSON.stringify(item));
  }

  /** Returns the committed outcome of a source of a run, for any kind of source. */
  public async findStoredItem(
    runId: string,
    sourceKey: string,
  ): Promise<StoredAgentImportItem | null> {
    const [row] = await this.database.query(
      `
        SELECT result_json
        FROM agent_import_items
        WHERE run_id = $run_id
            AND source_key = $source_key;
      `,
      { run_id: runId, source_key: sourceKey },
    );
    // Only recordItem and recordStructuredItem write this JSON, in their public schemas.
    return row
      ? (JSON.parse(
          readTextColumn(row, 0, "result_json"),
        ) as StoredAgentImportItem)
      : null;
  }

  /** Lists the outcomes of a run in application order, for any kind of source. */
  public async listStoredItems(
    runId: string,
  ): Promise<StoredAgentImportItem[]> {
    const rows = await this.database.query(
      `
        SELECT result_json
        FROM agent_import_items
        WHERE run_id = $run_id
        ORDER BY ordinal;
      `,
      { run_id: runId },
    );
    // Only recordItem and recordStructuredItem write this JSON, in their public schemas.
    return rows.map(
      (row) =>
        JSON.parse(
          readTextColumn(row, 0, "result_json"),
        ) as StoredAgentImportItem,
    );
  }

  /** Lists stable results in the accepted package's topological order. */
  public async listItems(runId: string): Promise<AgentImportItem[]> {
    const rows = await this.database.query(
      `
        SELECT result_json
        FROM agent_import_items
        WHERE run_id = $run_id
        ORDER BY ordinal;
      `,
      { run_id: runId },
    );
    // Items are written exclusively by recordItem in their original schema.
    return rows.map(
      (row) =>
        JSON.parse(readTextColumn(row, 0, "result_json")) as AgentImportItem,
    );
  }

  /** Marks a fully processed package complete or partial; interrupted runs remain running. */
  public async finishRun(runId: string): Promise<AgentImportCounts> {
    const counts = await this.refreshCounts(runId);
    await this.database.execute(
      `
        UPDATE agent_import_runs
        SET status = $status,
            finished_at = COALESCE(finished_at, $now),
            updated_at = $now
        WHERE id = $id;
      `,
      {
        id: runId,
        status: counts.conflict || counts.failed ? "partial" : "complete",
        now: Date.now(),
      },
    );
    return counts;
  }

  private async insertItem(
    runId: string,
    ordinal: number,
    item: Pick<
      AgentStructuredImportItem,
      "sourceKey" | "targetKey" | "action" | "targetId" | "errorCode"
    >,
    resultJson: string,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO agent_import_items (
            run_id,
            source_key,
            target_key,
            ordinal,
            action,
            target_id,
            error_code,
            result_json,
            created_at
        )
        VALUES (
            $run_id, $source_key, $target_key, $ordinal, $action,
            $target_id, $error_code, $result_json, $now
        );
      `,
      {
        run_id: runId,
        source_key: item.sourceKey,
        target_key: item.targetKey,
        ordinal,
        action: item.action,
        target_id: item.targetId,
        error_code: item.errorCode,
        result_json: resultJson,
        now: Date.now(),
      },
    );
    await this.refreshCounts(runId);
  }

  private async refreshCounts(runId: string): Promise<AgentImportCounts> {
    const [row] = await this.database.query(
      `
        SELECT
            COUNT(*) FILTER (WHERE action = 'created') AS created_count,
            COUNT(*) FILTER (WHERE action = 'skipped') AS skipped_count,
            COUNT(*) FILTER (WHERE action = 'conflict') AS conflict_count,
            COUNT(*) FILTER (WHERE action = 'failed') AS failed_count
        FROM agent_import_items
        WHERE run_id = $run_id;
      `,
      { run_id: runId },
    );
    if (!row) throw new Error("Import counts unavailable.");
    const counts = {
      created: readCountColumn(row, 0, "created_count"),
      skipped: readCountColumn(row, 1, "skipped_count"),
      conflict: readCountColumn(row, 2, "conflict_count"),
      failed: readCountColumn(row, 3, "failed_count"),
    };
    await this.database.execute(
      `
        UPDATE agent_import_runs
        SET created_count = $created,
            skipped_count = $skipped,
            conflict_count = $conflict,
            failed_count = $failed,
            updated_at = $now
        WHERE id = $id;
      `,
      { id: runId, ...counts, now: Date.now() },
    );
    return counts;
  }
}
