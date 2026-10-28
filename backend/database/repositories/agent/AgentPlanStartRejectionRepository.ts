import { readPlanStartRejection } from "@/backend/agents/AgentPlanStartRejectionInput";
import { readTextColumn } from "@/backend/database/RowValue";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type {
  AgentPlanStartRejection,
  AgentPlanStartRejectionPage,
} from "@/definition/AgentPlanStartRejection";

/** Durable refusals are scoped to the requesting user and plan. */
export class AgentPlanStartRejectionRepository {
  private readonly database: Pick<Database, "query" | "transaction">;

  public constructor(database: Pick<Database, "query" | "transaction">) {
    this.database = database;
  }

  /** Stores an already sanitized refusal after the rejected start has rolled back. */
  public async append(
    userId: string,
    planId: string,
    rejection: AgentPlanStartRejection,
    journal?: (
      transaction: DatabaseTransaction,
      entry: AgentPlanStartRejection,
    ) => Promise<void>,
  ): Promise<void> {
    const validated = readPlanStartRejection(rejection);
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
        INSERT INTO agent_plan_start_rejections (
            id, plan_id, user_id, created_at, rejection_json
        ) VALUES ($id, $plan_id, $user_id, $created_at, $rejection_json);
      `,
        {
          id: validated.id,
          plan_id: planId,
          user_id: userId,
          created_at: validated.createdAt,
          rejection_json: JSON.stringify(validated),
        },
      );
      await journal?.(transaction, validated);
    });
  }

  /** The most recent recorded refusal of this user, after the service checks current access. */
  public async latest(
    userId: string,
    planId: string,
  ): Promise<AgentPlanStartRejection | null> {
    const [row] = await this.database.query(
      `
        SELECT rejection_json
        FROM agent_plan_start_rejections
        WHERE user_id = $user_id
            AND plan_id = $plan_id
        ORDER BY sequence_number DESC
        LIMIT 1;
      `,
      { user_id: userId, plan_id: planId },
    );
    return row
      ? readPlanStartRejection(
          JSON.parse(readTextColumn(row, 0, "rejection_json")),
        )
      : null;
  }

  /** Reads one own entry, using a scoped immutable entry ID rather than a shifting offset. */
  public async page(
    userId: string,
    planId: string,
    before: string | null,
  ): Promise<AgentPlanStartRejectionPage> {
    const rows = await this.database.query(
      `
        SELECT rejection_json
        FROM agent_plan_start_rejections
        WHERE user_id = $user_id
            AND plan_id = $plan_id
            AND ($before IS NULL OR sequence_number < (
                SELECT sequence_number
                FROM agent_plan_start_rejections
                WHERE id = $before
                    AND user_id = $user_id
                    AND plan_id = $plan_id
            ))
        ORDER BY sequence_number DESC
        LIMIT 2;
      `,
      { user_id: userId, plan_id: planId, before },
    );
    const entry = rows[0]
      ? readPlanStartRejection(
          JSON.parse(readTextColumn(rows[0], 0, "rejection_json")),
        )
      : null;
    return { entry, nextBefore: rows.length > 1 && entry ? entry.id : null };
  }
}
