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
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
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

  /** Saves one completed result; the composite primary key prevents reuse. */
  public async insert(
    userId: string,
    operationId: string,
    operation: StoredAgentOperation,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_operation_keys (
          user_id, operation_id, operation, fingerprint, result_json, created_at
      ) VALUES ($user_id, $operation_id, $operation, $fingerprint, $result_json, $created_at);
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
}
