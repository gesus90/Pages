import { readCountColumn } from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Persists the personal validity preference without reviving ended connections. */
export class PairingPreferenceRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Reads a user's preference, defaulting to thirty days. */
  public async get(userId: string): Promise<number> {
    const rows = await this.database.query(
      "SELECT validity_days FROM mcp_pairing_preferences WHERE user_id = $user_id;",
      { user_id: userId },
    );
    return rows[0] ? readCountColumn(rows[0], 0, "validity_days") : 30;
  }

  /** Updates active credentials from their issuance time; expired ones stay expired. */
  public async set(userId: string, days: number, now: number): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO mcp_pairing_preferences (user_id, validity_days)
      VALUES ($user_id, $days)
      ON CONFLICT (user_id) DO UPDATE SET validity_days = excluded.validity_days;
    `,
      { user_id: userId, days },
    );
    await this.database.execute(
      `
      UPDATE personal_agent_tokens
      SET expires_at = CASE WHEN $days = 0 THEN NULL ELSE created_at + $days * 86400000 END
      WHERE user_id = $user_id
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > $now);
    `,
      { user_id: userId, days, now },
    );
  }
}
