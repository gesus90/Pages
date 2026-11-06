import { readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** A completed operation; it shares the same commit as its resulting objects. */
export interface StoredAgentOperation {
  readonly fingerprint: string;
  readonly operation: string;
  readonly resultJson: string;
}

/** Stores permanent owner-scoped operation keys for response-loss recovery. */
export class AgentOperationKeyRepository {
  private readonly database: Pick<DatabaseTransaction, "execute" | "query">;

  public constructor(database: Pick<DatabaseTransaction, "execute" | "query">) {
    this.database = database;
  }

  /** Looks up a prior result within the caller's transaction. */
  public async find(
    userId: string,
    operationId: string,
  ): Promise<StoredAgentOperation | null> {
    const [row] = await this.database.query(
      `
      SELECT
          fingerprint,
          operation,
          result_json
      FROM agent_operation_keys
      WHERE user_id = $user_id
          AND operation_id = $operation_id;
    `,
      { user_id: userId, operation_id: operationId },
    );
    return row
      ? {
          fingerprint: readTextColumn(row, 0, "fingerprint"),
          operation: readTextColumn(row, 1, "operation"),
          resultJson: readTextColumn(row, 2, "result_json"),
        }
      : null;
  }

  /**
   * Saves one completed result; the composite primary key prevents reuse.
   *
   * @remarks
   * The cast keeps U+0000 in the identifier, so PostgreSQL refuses it: without the
   * character it would be the key of another operation.
   */
  public async insert(
    userId: string,
    operationId: string,
    operation: StoredAgentOperation,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_operation_keys (
          user_id, operation_id, operation, fingerprint, result_json, created_at
      ) VALUES ($user_id, CAST($operation_id AS TEXT), $operation, $fingerprint, $result_json, $created_at);
    `,
      {
        user_id: userId,
        operation_id: operationId,
        operation: operation.operation,
        fingerprint: operation.fingerprint,
        result_json: operation.resultJson,
        created_at: Date.now(),
      },
    );
  }

  /**
   * Removes an account's results of one operation that are older than a point in time.
   *
   * @param userId - The account.
   * @param operation - The kind of operation, such as `ui.wiki.save`.
   * @param before - Milliseconds since the epoch; older results are removed.
   */
  public async removeOlder(
    userId: string,
    operation: string,
    before: number,
  ): Promise<void> {
    await this.database.execute(
      `
      DELETE FROM agent_operation_keys
      WHERE user_id = $user_id
          AND operation = $operation
          AND created_at < $before;
    `,
      { user_id: userId, operation, before },
    );
  }
}
