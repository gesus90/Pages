import { readCountColumn } from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";

function amount(input: unknown): number | null {
  const numeric = typeof input === "string" ? Number(input) : input;
  return typeof numeric === "number" && Number.isFinite(numeric) && numeric >= 0
    ? numeric
    : null;
}

/** Agent-account budgets consume the exact immutable USD figures of their Claude plan steps. */
export class ClaudeMonthlyBudgetRepository {
  private readonly database: Pick<DatabaseTransaction, "query">;
  public constructor(database: Pick<DatabaseTransaction, "query">) {
    this.database = database;
  }

  /** A normal person or an agent without a Claude budget has no limit. */
  public async limit(userId: string): Promise<number | null> {
    const [row] = await this.database.query(
      `
      SELECT claude_monthly_cost_limit
      FROM agent_employees
      WHERE user_id = $user_id;
    `,
      { user_id: userId },
    );
    return amount(row?.[0]);
  }

  /** Includes live/retried turns and counts unknown attempts without pretending they were free. */
  public async spent(
    userId: string,
    since: string,
  ): Promise<{ readonly known: number; readonly unknownSessions: number }> {
    const [row] = await this.database.query(
      `
      SELECT
          COALESCE(SUM((usage.claude_accounting::jsonb ->> 'costUsd')::DOUBLE PRECISION), 0),
          COUNT(DISTINCT attempts.attempt_id) FILTER (
              WHERE usage.claude_accounting IS NULL
                  OR usage.claude_accounting::jsonb ->> 'costUsd' IS NULL
          )
      FROM agent_session_attempts AS attempts
      LEFT JOIN agent_session_turn_usage AS usage
          ON usage.attempt_id = attempts.attempt_id
      WHERE attempts.user_id = $user_id
          AND attempts.provider = 'claude_code'
          AND COALESCE(usage.reported_at, attempts.updated_at) >= $since;
    `,
      { user_id: userId, since },
    );
    return {
      known: amount(row?.[0]) ?? 0,
      unknownSessions: row ? readCountColumn(row, 1, "unknown_sessions") : 0,
    };
  }
}
