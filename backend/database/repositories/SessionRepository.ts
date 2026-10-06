import {
  readBooleanColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";

/** Values required to persist a new session. */
export interface NewSession {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly lifetimeDays: number;
  /** Raw user agent of the browser that started the session. */
  readonly userAgent?: string | null;
}

/** An unexpired session of a user as stored in the database. */
export interface StoredActiveSession {
  readonly id: string;
  readonly tokenHash: string;
  readonly userAgent: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string;
}

/** Owns persistence operations for login sessions. */
export class SessionRepository {
  private readonly database: Database;

  /**
   * Creates a session repository.
   *
   * @param database - Central database access.
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
            user_agent,
            expires_at
        )
        SELECT
            $id,
            $user_id,
            $token_hash,
            $user_agent,
            utc_after(to_days($lifetime_days))
        WHERE EXISTS (
            SELECT 1
            FROM users
            WHERE id = $user_id
                AND is_active = 1
        );
      `,
      {
        id: session.id,
        user_id: session.userId,
        token_hash: session.tokenHash,
        user_agent: session.userAgent ?? null,
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
            user_id
        FROM sessions
        WHERE token_hash = $token_hash
            AND expires_at > utc_now();
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
   *
   * @remarks
   * The write is throttled to one update per minute and session, so browsing
   * does not turn every request into a database write.
   */
  public async markUsed(tokenHash: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE sessions
        SET last_used_at = utc_now()
        WHERE token_hash = $token_hash
            AND (
                last_used_at IS NULL
                OR last_used_at < utc_after(to_minutes(-1))
            );
      `,
      { token_hash: tokenHash },
    );
  }

  /**
   * Returns every unexpired session of a user.
   *
   * @param userId - Identifier of the session owner.
   * @param currentTokenHash - Hash of the token belonging to the request.
   * @returns The sessions with the current one listed first.
   */
  public async listActiveByUserId(
    userId: string,
    currentTokenHash: string,
  ): Promise<
    ReadonlyArray<StoredActiveSession & { readonly isCurrent: boolean }>
  > {
    const rows = await this.database.query(
      `
        SELECT
            id,
            token_hash,
            user_agent,
            created_at,
            last_used_at,
            CASE
                WHEN token_hash = $token_hash THEN 1
                ELSE 0
            END AS is_current
        FROM sessions
        WHERE user_id = $user_id
            AND expires_at > utc_now()
        ORDER BY is_current DESC, last_used_at DESC;
      `,
      { token_hash: currentTokenHash, user_id: userId },
    );

    return rows.map((row) => this.toStoredActiveSession(row));
  }

  /**
   * Returns the token hash of one unexpired session of a user.
   *
   * @param sessionId - Identifier of the session.
   * @param userId - Identifier of the session owner.
   * @returns The stored hash, or `null` when no matching active session exists.
   */
  public async findTokenHashByIdAndUserId(
    sessionId: string,
    userId: string,
  ): Promise<string | null> {
    const rows = await this.database.query(
      `
        SELECT
            token_hash
        FROM sessions
        WHERE id = $session_id
            AND user_id = $user_id
            AND expires_at > utc_now();
      `,
      { session_id: sessionId, user_id: userId },
    );

    const row = rows[0];

    return row ? readTextColumn(row, 0, "token_hash") : null;
  }

  /**
   * Removes one session of a user, invalidating its token.
   *
   * @param sessionId - Identifier of the session.
   * @param userId - Identifier of the session owner.
   */
  public async deleteByIdAndUserId(
    sessionId: string,
    userId: string,
  ): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM sessions
        WHERE id = $session_id
            AND user_id = $user_id;
      `,
      { session_id: sessionId, user_id: userId },
    );
  }

  /**
   * Removes every session of a user except the one owning the given token hash.
   *
   * @param userId - Identifier of the session owner.
   * @param tokenHash - Hash of the token that stays valid.
   */
  public async deleteAllExceptTokenHash(
    userId: string,
    tokenHash: string,
  ): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM sessions
        WHERE user_id = $user_id
            AND token_hash <> $token_hash;
      `,
      { token_hash: tokenHash, user_id: userId },
    );
  }

  /**
   * Removes every session of a user, invalidating all of their tokens.
   *
   * @param userId - Identifier of the session owner.
   */
  public async deleteAllByUserId(userId: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM sessions
        WHERE user_id = $user_id;
      `,
      { user_id: userId },
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
      WHERE expires_at <= utc_now();
    `);
  }

  private toStoredActiveSession(
    row: readonly DatabaseValue[],
  ): StoredActiveSession & { readonly isCurrent: boolean } {
    return {
      id: readTextColumn(row, 0, "id"),
      tokenHash: readTextColumn(row, 1, "token_hash"),
      userAgent: readNullableTextColumn(row, 2, "user_agent"),
      createdAt: readTextColumn(row, 3, "created_at"),
      lastUsedAt: readTextColumn(row, 4, "last_used_at"),
      isCurrent: readBooleanColumn(row, 5, "is_current"),
    };
  }
}
