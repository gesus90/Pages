import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { PersonalAgentToken } from "@/definition/McpAuthorization";

/** Persisted token facts; its hash is deliberately kept out of this shape. */
export type StoredPersonalToken = Omit<PersonalAgentToken, "status">;

/** Stores owner-bound personal tokens and serializes rotation with revocation. */
export class PersonalAgentTokenRepository {
  private readonly database: Pick<
    Database,
    "query" | "execute" | "transaction"
  >;

  public constructor(
    database: Pick<Database, "query" | "execute" | "transaction">,
  ) {
    this.database = database;
  }

  /** Executes an owner mutation atomically. */
  public async transaction<Result>(
    work: (repository: PersonalAgentTokenRepository) => Promise<Result>,
  ): Promise<Result> {
    return this.database.transaction((scope) =>
      work(
        new PersonalAgentTokenRepository({
          ...scope,
          transaction: async <Nested>(
            operation: (transaction: DatabaseTransaction) => Promise<Nested>,
          ): Promise<Nested> => operation(scope),
        }),
      ),
    );
  }

  /** Saves a credential hash alongside public audit facts. */
  public async insert(
    token: StoredPersonalToken,
    tokenHash: string,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO personal_agent_tokens (
          id, user_id, name, token_hash, created_at, expires_at, revoked_at
      ) VALUES ($id, $user_id, $name, $token_hash, $created_at, $expires_at, NULL);
    `,
      {
        id: token.id,
        user_id: token.userId,
        name: token.name,
        token_hash: tokenHash,
        created_at: token.createdAt,
        expires_at: token.expiresAt,
      },
    );
  }

  /** Returns public audit facts for the owner only. */
  public async list(userId: string): Promise<StoredPersonalToken[]> {
    const rows = await this.database.query(
      `
      SELECT
          id,
          user_id,
          name,
          CAST(created_at AS TEXT),
          CAST(expires_at AS TEXT),
          CAST(revoked_at AS TEXT)
      FROM personal_agent_tokens
      WHERE user_id = $user_id
      ORDER BY created_at DESC;
    `,
      { user_id: userId },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      userId: readTextColumn(row, 1, "user_id"),
      name: readTextColumn(row, 2, "name"),
      createdAt: Number(readTextColumn(row, 3, "created_at")),
      expiresAt: nullableTimestamp(
        readNullableTextColumn(row, 4, "expires_at"),
      ),
      revokedAt: nullableTimestamp(
        readNullableTextColumn(row, 5, "revoked_at"),
      ),
    }));
  }

  /** Resolves only a currently valid hash; clear text never reaches SQL. */
  public async findOwner(
    tokenHash: string,
    now: number,
  ): Promise<string | null> {
    const rows = await this.database.query(
      `
      SELECT user_id
      FROM personal_agent_tokens
      WHERE token_hash = $token_hash
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > $now);
    `,
      { token_hash: tokenHash, now },
    );
    return rows[0] ? readTextColumn(rows[0], 0, "user_id") : null;
  }

  /** Records an owner revocation once, preserving the original timestamp. */
  public async revoke(userId: string, id: string, now: number): Promise<void> {
    await this.database.execute(
      `
      UPDATE personal_agent_tokens
      SET revoked_at = $now
      WHERE id = $id
          AND user_id = $user_id
          AND revoked_at IS NULL;
    `,
      { id, user_id: userId, now },
    );
  }
}

function nullableTimestamp(timestamp: string | null): number | null {
  return timestamp === null ? null : Number(timestamp);
}
