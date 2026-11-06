import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** The stored identity of one open console (PAGE-239); never its output or input. */
export interface StoredConsoleSession {
  readonly id: string;
  readonly ownerId: string;
  readonly scopeKind: "workspace" | "connection";
  readonly scopeId: string;
  readonly columns: number;
  readonly rows: number;
  /** The shell attempt the console reached. */
  readonly attempts: number;
  /** The number of the last event sent, so a restored console continues after it. */
  readonly lastSequence: number;
}

function readScopeKind(value: string): StoredConsoleSession["scopeKind"] {
  if (value === "workspace" || value === "connection") return value;
  throw new Error('Database returned an invalid "scope_kind".');
}

/** Keeps console identities across an API restart, each for the console's lease. */
export class RemoteConsoleSessionRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /**
   * Stores a console or renews it; it expires after the lease.
   *
   * @param session - The console's identity and progress.
   * @param leaseSeconds - Seconds until a console nobody touches expires.
   */
  public async save(
    session: StoredConsoleSession,
    leaseSeconds: number,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO remote_console_sessions (
          id,
          owner_id,
          scope_kind,
          scope_id,
          column_count,
          row_count,
          attempts,
          last_sequence,
          expires_at
      )
      VALUES (
          $id,
          $owner_id,
          $scope_kind,
          $scope_id,
          $column_count,
          $row_count,
          $attempts,
          $last_sequence,
          utc_after($lease_seconds * INTERVAL '1 second')
      )
      ON CONFLICT (id) DO UPDATE SET
          column_count = excluded.column_count,
          row_count = excluded.row_count,
          attempts = excluded.attempts,
          last_sequence = excluded.last_sequence,
          expires_at = excluded.expires_at
      WHERE remote_console_sessions.owner_id = excluded.owner_id;
    `,
      {
        id: session.id,
        owner_id: session.ownerId,
        scope_kind: session.scopeKind,
        scope_id: session.scopeId,
        column_count: session.columns,
        row_count: session.rows,
        attempts: session.attempts,
        last_sequence: session.lastSequence,
        lease_seconds: leaseSeconds,
      },
    );
  }

  /**
   * Returns a console whose lease has not ended.
   *
   * @param id - The console.
   * @returns The stored console, or `null` when it is unknown or expired.
   */
  public async find(id: string): Promise<StoredConsoleSession | null> {
    const rows = await this.database.query(
      `
      SELECT
          id,
          owner_id,
          scope_kind,
          scope_id,
          column_count,
          row_count,
          attempts,
          last_sequence
      FROM remote_console_sessions
      WHERE id = $id
          AND expires_at > utc_now();
    `,
      { id },
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: readTextColumn(row, 0, "id"),
      ownerId: readTextColumn(row, 1, "owner_id"),
      scopeKind: readScopeKind(readTextColumn(row, 2, "scope_kind")),
      scopeId: readTextColumn(row, 3, "scope_id"),
      columns: readCountColumn(row, 4, "column_count"),
      rows: readCountColumn(row, 5, "row_count"),
      attempts: readCountColumn(row, 6, "attempts"),
      lastSequence: readCountColumn(row, 7, "last_sequence"),
    };
  }

  /**
   * Forgets a console, such as after its owner released it or it ended.
   *
   * @param id - The console.
   */
  public async remove(id: string): Promise<void> {
    await this.database.execute(
      `
      DELETE FROM remote_console_sessions
      WHERE id = $id;
    `,
      { id },
    );
  }

  /** Forgets every console whose lease ended. */
  public async removeExpired(): Promise<void> {
    await this.database.execute(`
      DELETE FROM remote_console_sessions
      WHERE expires_at <= utc_now();
    `);
  }
}
