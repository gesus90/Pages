import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import {
  CLAUDE_QUOTA_WINDOWS,
  isClaudeQuotaWindowKind,
  readClaudePlan,
} from "@/definition/ClaudeQuota";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { ClaudePlan, ClaudeQuotaWindow } from "@/definition/ClaudeQuota";

/** The stored subscription figures of one connection. */
export interface ClaudeQuotaRecord {
  readonly plan: ClaudePlan | null;
  readonly windows: readonly ClaudeQuotaWindow[];
}

const EMPTY_RECORD: ClaudeQuotaRecord = { plan: null, windows: [] };

/** Stores what Claude Code reports about the subscription of each connection. */
export class ClaudeQuotaRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /**
   * Stores one reported window of a connection.
   * @param connectionId - The connection whose session reported it.
   * @param window - The window with its used share and reset.
   * @param observedAt - ISO time of the reading; an older reading never
   * replaces a newer one.
   */
  public async saveWindow(
    connectionId: string,
    window: ClaudeQuotaWindow,
    observedAt: string,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO claude_connection_quota_windows (
          connection_id,
          window_kind,
          used_percentage,
          resets_at,
          observed_at
      )
      VALUES (
          $connection_id,
          $window_kind,
          $used_percentage,
          $resets_at,
          $observed_at
      )
      ON CONFLICT (connection_id, window_kind) DO UPDATE SET
          used_percentage = excluded.used_percentage,
          resets_at = excluded.resets_at,
          observed_at = excluded.observed_at
      WHERE claude_connection_quota_windows.observed_at <= excluded.observed_at;
    `,
      {
        connection_id: connectionId,
        window_kind: window.kind,
        used_percentage: window.usedPercentage,
        resets_at: window.resetsAt,
        observed_at: observedAt,
      },
    );
  }

  /**
   * Stores a complete usage reading of a connection.
   * @param connectionId - The connection that was queried.
   * @param windows - Every window the usage endpoint reported.
   * @param observedAt - ISO time of the reading.
   * @remarks
   * The reading names every current window, so a window it lacks is removed
   * instead of kept or stored as 0; a newer session reading stays.
   */
  public async replaceWindows(
    connectionId: string,
    windows: readonly ClaudeQuotaWindow[],
    observedAt: string,
  ): Promise<void> {
    for (const kind of CLAUDE_QUOTA_WINDOWS) {
      if (windows.some((window) => window.kind === kind)) continue;
      await this.database.execute(
        `
        DELETE FROM claude_connection_quota_windows
        WHERE connection_id = $connection_id
            AND window_kind = $window_kind
            AND observed_at <= $observed_at;
      `,
        {
          connection_id: connectionId,
          window_kind: kind,
          observed_at: observedAt,
        },
      );
    }
    for (const window of windows)
      await this.saveWindow(connectionId, window, observedAt);
  }

  /**
   * Stores the subscription a connection's sign-in reported.
   * @param connectionId - The connection.
   * @param plan - The plan, or `null` for a sign-in without a known plan.
   * @param observedAt - ISO time of the reading.
   */
  public async savePlan(
    connectionId: string,
    plan: ClaudePlan | null,
    observedAt: string,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO claude_connection_plans (
          connection_id,
          plan,
          observed_at
      )
      VALUES (
          $connection_id,
          $plan,
          $observed_at
      )
      ON CONFLICT (connection_id) DO UPDATE SET
          plan = excluded.plan,
          observed_at = excluded.observed_at
      WHERE claude_connection_plans.observed_at <= excluded.observed_at;
    `,
      { connection_id: connectionId, plan, observed_at: observedAt },
    );
  }

  /**
   * Reads the stored figures of every connection.
   * @returns The figures by connection; a connection without a reading is absent.
   */
  public async list(): Promise<ReadonlyMap<string, ClaudeQuotaRecord>> {
    const planRows = await this.database.query(
      `
      SELECT
          connection_id,
          plan
      FROM claude_connection_plans;
    `,
    );
    const windowRows = await this.database.query(
      `
      SELECT
          connection_id,
          window_kind,
          used_percentage,
          resets_at
      FROM claude_connection_quota_windows
      ORDER BY connection_id;
    `,
    );
    const records = new Map<string, ClaudeQuotaRecord>();
    for (const row of planRows) {
      const connectionId = readTextColumn(row, 0, "connection_id");
      records.set(connectionId, {
        ...EMPTY_RECORD,
        plan: readClaudePlan(readNullableTextColumn(row, 1, "plan")),
      });
    }
    for (const row of windowRows) {
      const connectionId = readTextColumn(row, 0, "connection_id");
      const kind = readTextColumn(row, 1, "window_kind");
      if (!isClaudeQuotaWindowKind(kind)) continue;
      const record = records.get(connectionId) ?? EMPTY_RECORD;
      records.set(connectionId, {
        ...record,
        windows: [
          ...record.windows,
          {
            kind,
            usedPercentage: readCountColumn(row, 2, "used_percentage"),
            resetsAt: readTextColumn(row, 3, "resets_at"),
          },
        ],
      });
    }
    return records;
  }

  /**
   * Removes the figures of a removed connection.
   * @param connectionId - The connection.
   */
  public async remove(connectionId: string): Promise<void> {
    const parameters = { connection_id: connectionId };
    await this.database.execute(
      "DELETE FROM claude_connection_quota_windows WHERE connection_id = $connection_id;",
      parameters,
    );
    await this.database.execute(
      "DELETE FROM claude_connection_plans WHERE connection_id = $connection_id;",
      parameters,
    );
  }
}
