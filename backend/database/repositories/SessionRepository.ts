import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** Values required to persist a new session. */
export interface NewSession {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly lifetimeDays: number;
}

/** Owns persistence operations for login sessions. */
export class SessionRepository {
  private readonly database: Database;

  /**
   * Creates a session repository.
   *
   * @param database - Central DuckDB access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Inserts a session that expires after the given lifetime.
   *
   * @param session - Session values including the hashed token.
   */
  public async insert(session: NewSession): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO sessions (
            id,
            user_id,
            token_hash,
            expires_at
        )
        VALUES (
            CAST($id AS UUID),
            CAST($user_id AS UUID),
            $token_hash,
            CURRENT_TIMESTAMP + INTERVAL ($lifetime_days) DAY
        );
      `,
      {
        id: session.id,
        user_id: session.userId,
        token_hash: session.tokenHash,
        lifetime_days: session.lifetimeDays,
      },
    );
  }

  /**
   * Returns the owner of an unexpired session.
   *
   * @param tokenHash - Hash of the token sent by the browser.
   * @returns The user identifier, or `null` when no valid session exists.
   */
  public async findUserIdByTokenHash(
    tokenHash: string,
  ): Promise<string | null> {
    const rows = await this.database.query(
      `
        SELECT
            CAST(user_id AS VARCHAR) AS user_id
        FROM sessions
        WHERE token_hash = $token_hash
            AND expires_at > CURRENT_TIMESTAMP;
      `,
      { token_hash: tokenHash },
    );

    const row = rows[0];

    return row ? readTextColumn(row, 0, "user_id") : null;
  }

  /**
   * Records that a session was used for a request.
   *
   * @param tokenHash - Hash of the token sent by the browser.
   */
  public async markUsed(tokenHash: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE sessions
        SET last_used_at = CURRENT_TIMESTAMP
        WHERE token_hash = $token_hash;
      `,
      { token_hash: tokenHash },
    );
  }

  /**
   * Removes a single session, invalidating its token.
   *
   * @param tokenHash - Hash of the token sent by the browser.
   */
  public async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM sessions
        WHERE token_hash = $token_hash;
      `,
      { token_hash: tokenHash },
    );
  }

  /** Removes every session that has already expired. */
  public async deleteExpired(): Promise<void> {
    await this.database.execute(`
      DELETE FROM sessions
      WHERE expires_at <= CURRENT_TIMESTAMP;
    `);
  }
}
