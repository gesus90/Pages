import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { ANTIGRAVITY_QUOTA_WINDOWS } from "@/definition/AntigravityQuota";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type {
  AntigravityQuotaGroup,
  AntigravityQuotaWindow,
  AntigravityQuotaWindowKind,
} from "@/definition/AntigravityQuota";

/**
 * The stored quota of one connection.
 * @remarks
 * `reportedAt` is the ISO time of the last successful answer of Antigravity,
 * also when that answer held no quota data; a connection without an answer
 * has no record.
 */
export interface AntigravityQuotaRecord {
  readonly groups: readonly AntigravityQuotaGroup[];
  readonly reportedAt: string;
}

function isWindowKind(value: string): value is AntigravityQuotaWindowKind {
  return ANTIGRAVITY_QUOTA_WINDOWS.some((kind) => kind === value);
}

/**
 * Builds the groups of one connection from its stored window rows.
 * @remarks
 * A group is named by the position it had in the source, so the order of
 * the source survives; a row of an unknown window kind is left out.
 */
function readGroups(
  rows: readonly (readonly DatabaseValue[])[],
): AntigravityQuotaGroup[] {
  const groups = new Map<
    number,
    { readonly name: string; readonly windows: AntigravityQuotaWindow[] }
  >();
  for (const row of rows) {
    const kind = readTextColumn(row, 3, "window_kind");
    if (!isWindowKind(kind)) continue;
    const position = readCountColumn(row, 1, "group_position");
    const group = groups.get(position) ?? {
      name: readTextColumn(row, 2, "group_name"),
      windows: [],
    };
    group.windows.push({
      kind,
      remainingFraction: readCountColumn(row, 4, "remaining_fraction"),
      resetsAt: readNullableTextColumn(row, 5, "resets_at"),
    });
    groups.set(position, group);
  }
  return [...groups]
    .sort(([first], [second]) => first - second)
    .map(([, group]) => group);
}

/** Stores what Antigravity reports about the quota of each connection. */
export class AntigravityQuotaRepository {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Replaces the stored quota of a connection with a complete reading.
   * @param connectionId - The connection that was queried.
   * @param groups - Every group the reading named, in the order of the source.
   * @param observedAt - ISO time of the reading; an older reading never
   * replaces a newer one.
   * @remarks
   * The reading names every current group and window, so one it lacks is
   * removed instead of kept or stored as 0. The replacement is one
   * transaction, so a reader never sees half a reading.
   */
  public async replaceReading(
    connectionId: string,
    groups: readonly AntigravityQuotaGroup[],
    observedAt: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const isStored = await this.storeHeader(
        transaction,
        connectionId,
        observedAt,
      );
      if (!isStored) return;
      await transaction.execute(
        "DELETE FROM antigravity_connection_quota_windows WHERE connection_id = $connection_id;",
        { connection_id: connectionId },
      );
      for (const [position, group] of groups.entries())
        await this.storeGroup(transaction, connectionId, position, group);
    });
  }

  /**
   * Reads the stored quota of every connection.
   * @returns The quota by connection; a connection without an answer is absent.
   */
  public async list(): Promise<ReadonlyMap<string, AntigravityQuotaRecord>> {
    const headers = await this.database.query(
      `
      SELECT
          connection_id,
          observed_at
      FROM antigravity_connection_quotas;
    `,
    );
    const windows = await this.database.query(
      `
      SELECT
          connection_id,
          group_position,
          group_name,
          window_kind,
          remaining_fraction,
          resets_at
      FROM antigravity_connection_quota_windows
      ORDER BY connection_id, group_position;
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
      headers.map((row): [string, AntigravityQuotaRecord] => {
        const connectionId = readTextColumn(row, 0, "connection_id");
        return [
          connectionId,
          {
            groups: readGroups(rowsByConnection.get(connectionId) ?? []),
            reportedAt: readTextColumn(row, 1, "observed_at"),
          },
        ];
      }),
    );
  }

  /** Whether the reading is the newest one and its time is stored. */
  private async storeHeader(
    transaction: DatabaseTransaction,
    connectionId: string,
    observedAt: string,
  ): Promise<boolean> {
    const rows = await transaction.query(
      `
      INSERT INTO antigravity_connection_quotas (
          connection_id,
          observed_at
      )
      VALUES (
          $connection_id,
          $observed_at
      )
      ON CONFLICT (connection_id) DO UPDATE SET
          observed_at = excluded.observed_at
      WHERE antigravity_connection_quotas.observed_at <= excluded.observed_at
      RETURNING connection_id;
    `,
      { connection_id: connectionId, observed_at: observedAt },
    );
    return rows.length > 0;
  }

  private async storeGroup(
    transaction: DatabaseTransaction,
    connectionId: string,
    position: number,
    group: AntigravityQuotaGroup,
  ): Promise<void> {
    for (const window of group.windows)
      await transaction.execute(
        `
        INSERT INTO antigravity_connection_quota_windows (
            connection_id,
            group_position,
            group_name,
            window_kind,
            remaining_fraction,
            resets_at
        )
        VALUES (
            $connection_id,
            $group_position,
            $group_name,
            $window_kind,
            $remaining_fraction,
            $resets_at
        );
      `,
        {
          connection_id: connectionId,
          group_position: position,
          group_name: group.name,
          window_kind: window.kind,
          remaining_fraction: window.remainingFraction,
          resets_at: window.resetsAt,
        },
      );
  }
}
