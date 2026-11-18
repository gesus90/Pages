import {
  readBooleanColumn,
  readCountColumn,
  readNullableCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { isCodexQuotaWindowKind, readCodexPlan } from "@/definition/CodexQuota";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { CodexPlan, CodexQuotaWindow } from "@/definition/CodexQuota";

/**
 * The stored quota of one connection.
 * @remarks
 * `reportedAt` is the ISO time of the last successful answer of the app
 * server, also when that answer held no window; a connection without an
 * answer has no record.
 */
export interface CodexQuotaRecord {
  readonly plan: CodexPlan | null;
  readonly windows: readonly CodexQuotaWindow[];
  readonly isLimitReached: boolean;
  readonly reportedAt: string;
}

/** What one successful answer of the app server holds. */
export interface CodexQuotaReading {
  readonly plan: CodexPlan | null;
  readonly windows: readonly CodexQuotaWindow[];
  readonly isLimitReached: boolean;
}

function readWindows(
  rows: readonly (readonly DatabaseValue[])[],
): CodexQuotaWindow[] {
  const windows: CodexQuotaWindow[] = [];
  for (const row of rows) {
    const kind = readTextColumn(row, 1, "window_kind");
    if (!isCodexQuotaWindowKind(kind)) continue;
    windows.push({
      kind,
      usedPercent: readCountColumn(row, 2, "used_percent"),
      durationMinutes: readNullableCountColumn(row, 3, "duration_minutes"),
      resetsAt: readNullableTextColumn(row, 4, "resets_at"),
    });
  }
  return windows;
}

/** Stores what the Codex app server reports about the quota of each connection. */
export class CodexQuotaRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Replaces the stored quota of a connection with a complete reading.
   * @param connectionId - The connection that was queried.
   * @param reading - The plan, the limit statement and every window the answer named.
   * @param observedAt - ISO time of the reading; an older reading never
   * replaces a newer one, while a newer one always sets the time, also when
   * every figure is unchanged.
   * @remarks
   * The reading names every current window, so one it lacks is removed
   * instead of kept or stored as 0. The replacement is one transaction, so a
   * reader never sees half a reading.
   */
  public async replaceReading(
    connectionId: string,
    reading: CodexQuotaReading,
    observedAt: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const isStored = await this.storeHeader(
        transaction,
        connectionId,
        reading,
        observedAt,
      );
      if (!isStored) return;
      await transaction.execute(
        "DELETE FROM codex_connection_quota_windows WHERE connection_id = $connection_id;",
        { connection_id: connectionId },
      );
      for (const window of reading.windows)
        await this.storeWindow(transaction, connectionId, window);
    });
  }

  /**
   * Reads the stored quota of every connection.
   * @returns The quota by connection; a connection without an answer is absent.
   */
  public async list(): Promise<ReadonlyMap<string, CodexQuotaRecord>> {
    const headers = await this.database.query(
      `
      SELECT
          connection_id,
          plan,
          is_limit_reached,
          observed_at
      FROM codex_connection_quotas;
    `,
    );
    const windows = await this.database.query(
      `
      SELECT
          connection_id,
          window_kind,
          used_percent,
          duration_minutes,
          resets_at
      FROM codex_connection_quota_windows
      ORDER BY connection_id, window_kind;
    `,
    );
    const rowsByConnection = new Map<string, DatabaseValue[][]>();
    for (const row of windows) {
      const connectionId = readTextColumn(row, 0, "connection_id");
      rowsByConnection.set(connectionId, [
        ...(rowsByConnection.get(connectionId) ?? []),
        [...row],
      ]);
    }
    return new Map(
      headers.map((row): [string, CodexQuotaRecord] => {
        const connectionId = readTextColumn(row, 0, "connection_id");
        return [
          connectionId,
          {
            plan: readCodexPlan(readNullableTextColumn(row, 1, "plan")),
            windows: readWindows(rowsByConnection.get(connectionId) ?? []),
            isLimitReached: readBooleanColumn(row, 2, "is_limit_reached"),
            reportedAt: readTextColumn(row, 3, "observed_at"),
          },
        ];
      }),
    );
  }

  /** Whether the reading is the newest one and its figures and time are stored. */
  private async storeHeader(
    transaction: DatabaseTransaction,
    connectionId: string,
    reading: CodexQuotaReading,
    observedAt: string,
  ): Promise<boolean> {
    const rows = await transaction.query(
      `
      INSERT INTO codex_connection_quotas (
          connection_id,
          plan,
          is_limit_reached,
          observed_at
      )
      VALUES (
          $connection_id,
          $plan,
          $is_limit_reached,
          $observed_at
      )
      ON CONFLICT (connection_id) DO UPDATE SET
          plan = excluded.plan,
          is_limit_reached = excluded.is_limit_reached,
          observed_at = excluded.observed_at
      WHERE codex_connection_quotas.observed_at <= excluded.observed_at
      RETURNING connection_id;
    `,
      {
        connection_id: connectionId,
        plan: reading.plan,
        is_limit_reached: reading.isLimitReached,
        observed_at: observedAt,
      },
    );
    return rows.length > 0;
  }

  private async storeWindow(
    transaction: DatabaseTransaction,
    connectionId: string,
    window: CodexQuotaWindow,
  ): Promise<void> {
    await transaction.execute(
      `
      INSERT INTO codex_connection_quota_windows (
          connection_id,
          window_kind,
          used_percent,
          duration_minutes,
          resets_at
      )
      VALUES (
          $connection_id,
          $window_kind,
          $used_percent,
          $duration_minutes,
          $resets_at
      );
    `,
      {
        connection_id: connectionId,
        window_kind: window.kind,
        used_percent: window.usedPercent,
        duration_minutes: window.durationMinutes,
        resets_at: window.resetsAt,
      },
    );
  }
}
