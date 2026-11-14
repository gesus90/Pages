import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";
import { runnerStateSchema } from "@/definition/RunnerProtocol";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { RunnerState } from "@/definition/RunnerProtocol";

/** Persisted pairing bound to the exact SSH configuration that authorized it. */
export interface RunnerRecord {
  readonly connectionId: string;
  readonly runnerId: string;
  readonly tokenHash: string;
  readonly connectionRevision: number;
  readonly state: RunnerState;
}

/** Stores runner identities and acknowledged protocol checkpoints in DuckDB. */
export class RunnerRepository {
  private readonly database: Database;
  public constructor(database: Database) {
    this.database = database;
  }

  /** Reads the registered runner, including the server-only token digest. */
  public async find(connectionId: string): Promise<RunnerRecord | null> {
    const rows = await this.database.query(
      `
      SELECT
          connection_id,
          runner_id,
          token_hash,
          connection_revision,
          state_json
      FROM pages_runners
      WHERE connection_id = $connection_id;
    `,
      { connection_id: connectionId },
    );
    const row = rows[0];
    if (!row) return null;
    return {
      connectionId: readTextColumn(row, 0, "connection_id"),
      runnerId: readTextColumn(row, 1, "runner_id"),
      tokenHash: readTextColumn(row, 2, "token_hash"),
      connectionRevision: readCountColumn(row, 3, "connection_revision"),
      state: runnerStateSchema.parse(
        JSON.parse(readTextColumn(row, 4, "state_json")),
      ),
    };
  }

  /** Inserts one pairing; an existing identity cannot be replaced by registration. */
  public async create(record: RunnerRecord): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO pages_runners (
          connection_id,
          runner_id,
          token_hash,
          connection_revision,
          state_json
      ) VALUES (
          $connection_id,
          $runner_id,
          $token_hash,
          $connection_revision,
          $state_json
      );
    `,
      {
        connection_id: record.connectionId,
        runner_id: record.runnerId,
        token_hash: record.tokenHash,
        connection_revision: record.connectionRevision,
        state_json: JSON.stringify(record.state),
      },
    );
  }

  /** Commits state before its event acknowledgement is sent. */
  public async checkpoint(
    connectionId: string,
    state: RunnerState,
    journal?: (transaction: DatabaseTransaction) => Promise<void>,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await journal?.(transaction);
      await transaction.execute(
        `
      UPDATE pages_runners
      SET state_json = $state_json
      WHERE connection_id = $connection_id;
    `,
        { connection_id: connectionId, state_json: JSON.stringify(state) },
      );
    });
  }

  /** Wakes only obligations of a runner whose authenticated channel became available again. */
  public async reconnected(connectionId: string): Promise<void> {
    await this.database.execute(
      `
      UPDATE agent_workspace_cleanup AS cleanup
      SET attempts = 0, next_attempt_at = 0, retry_started_at = utc_now(),
          event_revision = event_revision + 1, state = 'pending',
          updated_at = CASE WHEN cleanup.state <> 'pending' THEN utc_now() ELSE cleanup.updated_at END
      FROM agent_plan_runs AS runs
      WHERE runs.id = cleanup.run_id AND cleanup.state <> 'completed'
          AND jsonb_path_exists(runs.view_json::jsonb,
              '$.**.connectionId ? (@ == $connection)',
              jsonb_build_object('connection', $connection_id::text));
    `,
      { connection_id: connectionId },
    );
  }

  /** Removes credentials and checkpoints after an explicit administrator revocation. */
  public async remove(connectionId: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM pages_runners WHERE connection_id = $connection_id;",
      { connection_id: connectionId },
    );
  }
}
