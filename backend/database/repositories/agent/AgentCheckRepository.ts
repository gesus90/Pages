import { sanitizeCheckDetail } from "@/backend/agents/AgentCheckDetail";
import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AgentError, isAgentErrorCode } from "@/backend/error/AgentErrors";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type {
  AgentCheckKind,
  AgentCheckSummary,
} from "@/definition/AgentConnection";

/** Stores only the latest outcome of each explicit check kind. */
export class AgentCheckRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Reads one check without ever joining the connection secret. */
  public async find(
    connectionId: string,
    kind: AgentCheckKind,
  ): Promise<AgentCheckSummary | null> {
    const rows = await this.database.query(
      `
      SELECT
          status,
          error_code,
          detail_json,
          duration_ms,
          checked_at
      FROM agent_connection_checks
      WHERE connection_id = $connection_id
          AND kind = $kind;
    `,
      { connection_id: connectionId, kind },
    );
    const row = rows[0];
    if (!row) return null;
    const status = readTextColumn(row, 0, "status");
    const errorCode = readNullableTextColumn(row, 1, "error_code");
    if (
      (status !== "passed" && status !== "failed") ||
      (errorCode !== null && !isAgentErrorCode(errorCode))
    ) {
      throw new AgentError("provider_bad_response");
    }
    const parsed: unknown = JSON.parse(readTextColumn(row, 2, "detail_json"));
    return {
      status,
      errorCode,
      detail: sanitizeCheckDetail(parsed),
      durationMs: readCountColumn(row, 3, "duration_ms"),
      checkedAt: readTextColumn(row, 4, "checked_at"),
    };
  }

  /** Upserts safe measurements and attribution, replacing only the selected check kind. */
  public async save(
    connectionId: string,
    kind: AgentCheckKind,
    check: AgentCheckSummary,
    checkedBy: string,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_connection_checks (
          connection_id,
          kind,
          status,
          error_code,
          detail_json,
          duration_ms,
          checked_by,
          checked_at
      ) VALUES (
          $connection_id,
          $kind,
          $status,
          $error_code,
          $detail_json,
          $duration_ms,
          $checked_by,
          $checked_at
      )
      ON CONFLICT (connection_id, kind) DO UPDATE SET
          status = excluded.status,
          error_code = excluded.error_code,
          detail_json = excluded.detail_json,
          duration_ms = excluded.duration_ms,
          checked_by = excluded.checked_by,
          checked_at = excluded.checked_at;
    `,
      {
        connection_id: connectionId,
        kind,
        status: check.status,
        error_code: check.errorCode,
        detail_json: JSON.stringify(sanitizeCheckDetail(check.detail)),
        duration_ms: check.durationMs,
        checked_by: checkedBy,
        checked_at: check.checkedAt,
      },
    );
  }

  /** Clears both check kinds after a credential change or before deletion. */
  public async clear(connectionId: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM agent_connection_checks WHERE connection_id = $connection_id;",
      { connection_id: connectionId },
    );
  }

  /** A different test model invalidates its result while retaining the access check. */
  public async clearModel(connectionId: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM agent_connection_checks WHERE connection_id = $connection_id AND kind = 'model';",
      { connection_id: connectionId },
    );
  }
}
