import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** The card order one account stored for the Agents page. */
export class AgentQuotaCardOrderRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /**
   * Returns the stored order of an account as the JSON array it was saved as.
   * @param userId - The account.
   * @returns The JSON text, or `null` when the account never sorted its cards.
   */
  public async readJson(userId: string): Promise<string | null> {
    const rows = await this.database.query(
      `
        SELECT connection_ids_json
        FROM agent_quota_card_orders
        WHERE user_id = $user_id;
      `,
      { user_id: userId },
    );
    const [row] = rows;
    return row ? readTextColumn(row, 0, "connection_ids_json") : null;
  }

  /**
   * Stores the order of an account and replaces the one stored before.
   * @param userId - The account.
   * @param order - The order as JSON text and the time of the change.
   */
  public async writeJson(
    userId: string,
    order: {
      readonly connectionIdsJson: string;
      readonly updatedAt: string;
    },
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO agent_quota_card_orders (
            user_id,
            connection_ids_json,
            updated_at
        )
        VALUES (
            $user_id,
            $connection_ids_json,
            $updated_at
        )
        ON CONFLICT (user_id) DO UPDATE
        SET
            connection_ids_json = EXCLUDED.connection_ids_json,
            updated_at = EXCLUDED.updated_at;
      `,
      {
        user_id: userId,
        connection_ids_json: order.connectionIdsJson,
        updated_at: order.updatedAt,
      },
    );
  }
}
