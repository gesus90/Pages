import { readTextColumn } from "@/backend/database/RowValue";
import { claudeLedgerSchema } from "@/definition/ClaudeUsage";
import { claudePriceModelsSchema } from "@/definition/ClaudePriceModels";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { ClaudeLedger } from "@/definition/ClaudeUsage";

/** Transactional custody of cumulative Claude session counters. */
export class ClaudeUsageRepository {
  private readonly database: DatabaseTransaction;
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Serializes native reports across owners, retries and importer replay. */
  public async lock(sessionId: string): Promise<ClaudeLedger> {
    await this.database.execute(
      `
      INSERT INTO claude_usage_sessions (session_id, state)
      VALUES ($session_id, $state)
      ON CONFLICT (session_id) DO NOTHING;
    `,
      {
        session_id: sessionId,
        state: JSON.stringify({ settled: [], messages: {}, seen: [] }),
      },
    );
    const [row] = await this.database.query(
      `
      SELECT state
      FROM claude_usage_sessions
      WHERE session_id = $session_id
      FOR UPDATE;
    `,
      { session_id: sessionId },
    );
    if (!row) throw new Error("Claude session ledger disappeared");
    return claudeLedgerSchema.parse(
      JSON.parse(readTextColumn(row, 0, "state")),
    );
  }

  /** Commits the new watermark in the same transaction as its allocated tokens and prices. */
  public async save(sessionId: string, state: ClaudeLedger): Promise<void> {
    await this.database.execute(
      `
      UPDATE claude_usage_sessions
      SET state = $state
      WHERE session_id = $session_id;
    `,
      { session_id: sessionId, state: JSON.stringify(state) },
    );
  }

  /** Reads admin overrides for the exact connection the attempt was assigned. */
  public async modelOverrides(
    attemptId: string,
  ): Promise<Readonly<Record<string, string>>> {
    const [row] = await this.database.query(
      `
      SELECT agent_connections.claude_price_models
      FROM agent_session_attempts
      INNER JOIN agent_connections
          ON agent_connections.id = agent_session_attempts.connection_id
      WHERE agent_session_attempts.attempt_id = $attempt_id;
    `,
      { attempt_id: attemptId },
    );
    if (!row) return {};
    return claudePriceModelsSchema.parse(
      JSON.parse(readTextColumn(row, 0, "claude_price_models")),
    );
  }
}
