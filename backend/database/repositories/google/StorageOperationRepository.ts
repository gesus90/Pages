import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";

import type { Database } from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";

/** Durable operation reservation around an external Drive mutation; a crash leaves a refused pending receipt. */
export class StorageOperationRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Claims a new operation atomically; a duplicate returns the previously reserved or finished operation. */
  public async claim(
    userId: string,
    operationId: string,
    receipt: Omit<StoredAgentOperation, "resultJson">,
  ): Promise<StoredAgentOperation | null> {
    const rows = await this.database.query(
      `
      INSERT INTO agent_operation_keys (
          user_id,
          operation_id,
          operation,
          fingerprint,
          result_json,
          created_at
      ) VALUES ($user_id, $operation_id, $operation, $fingerprint, 'null', $created_at)
      ON CONFLICT (user_id, operation_id) DO NOTHING
      RETURNING operation_id;
    `,
      {
        user_id: userId,
        operation_id: operationId,
        operation: receipt.operation,
        fingerprint: receipt.fingerprint,
        created_at: Date.now(),
      },
    );
    if (rows.length > 0) return null;
    const stored = await new AgentOperationKeyRepository(this.database).find(
      userId,
      operationId,
    );
    if (!stored) throw new Error("Storage receipt unavailable.");
    return stored;
  }

  /** Completes the reserved operation only after the external call and its history were saved. */
  public async finish(
    userId: string,
    operationId: string,
    resultJson: string,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE agent_operation_keys
      SET result_json = $result_json
      WHERE user_id = $user_id
          AND operation_id = $operation_id
          AND result_json = 'null';
    `,
      { user_id: userId, operation_id: operationId, result_json: resultJson },
    );
  }
}
