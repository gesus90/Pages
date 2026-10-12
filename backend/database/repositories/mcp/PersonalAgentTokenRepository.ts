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
          id, user_id, name, token_hash, created_at, expires_at, revoked_at, source, device_label
      ) VALUES ($id, $user_id, $name, $token_hash, $created_at, $expires_at, NULL, $source, $device);
    `,
      {
        id: token.id,
        user_id: token.userId,
        name: token.name,
        token_hash: tokenHash,
        created_at: token.createdAt,
        expires_at: token.expiresAt,
        source: token.source,
        device: token.device,
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
          CAST(revoked_at AS TEXT),
          source,
          device_label,
          CAST(last_used_at AS TEXT),
          CAST(rotated_at AS TEXT),
          CAST(rotation_requested_at AS TEXT)
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
      source:
        readTextColumn(row, 6, "source") === "pairing" ? "pairing" : "manual",
      device: readNullableTextColumn(row, 7, "device_label"),
      lastUsedAt: nullableTimestamp(
        readNullableTextColumn(row, 8, "last_used_at"),
      ),
      rotatedAt: nullableTimestamp(
        readNullableTextColumn(row, 9, "rotated_at"),
      ),
      rotationRequestedAt: nullableTimestamp(
        readNullableTextColumn(row, 10, "rotation_requested_at"),
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
      WHERE (token_hash = $token_hash OR (previous_token_hash = $token_hash AND previous_valid_until > $now))
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
      SET revoked_at = $now,
          previous_token_hash = NULL,
          previous_valid_until = NULL,
          rotation_requested_at = NULL
      WHERE id = $id
          AND user_id = $user_id
          AND revoked_at IS NULL;
    `,
      { id, user_id: userId, now },
    );
  }

  /** Returns public metadata only for a valid presented credential. */
  public async describe(
    tokenHash: string,
    now: number,
  ): Promise<StoredPersonalToken | null> {
    const owner = await this.findOwner(tokenHash, now);
    if (!owner) return null;
    const rows = await this.database.query(
      `
      SELECT id
      FROM personal_agent_tokens
      WHERE token_hash = $hash
          OR (previous_token_hash = $hash AND previous_valid_until > $now);
    `,
      { hash: tokenHash, now },
    );
    const row = rows[0];
    if (!row) return null;
    return (
      (await this.list(owner)).find(
        (token) => token.id === readTextColumn(row, 0, "id"),
      ) ?? null
    );
  }

  /** Tracks successful use at most once a minute and ends overlap on first use of the new token. */
  public async used(tokenHash: string, now: number): Promise<void> {
    await this.database.execute(
      `
      UPDATE personal_agent_tokens
      SET last_used_at = CASE WHEN last_used_at IS NULL OR last_used_at <= $now - 60000 THEN $now ELSE last_used_at END,
          previous_token_hash = CASE WHEN token_hash = $hash THEN NULL ELSE previous_token_hash END,
          previous_valid_until = CASE WHEN token_hash = $hash THEN NULL ELSE previous_valid_until END
      WHERE revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > $now)
          AND (token_hash = $hash OR (previous_token_hash = $hash AND previous_valid_until > $now));
    `,
      { hash: tokenHash, now },
    );
  }

  /** Requests rotation for one active owner-bound paired credential. */
  public async requestRotation(
    userId: string,
    id: string,
    now: number,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE personal_agent_tokens
      SET rotation_requested_at = COALESCE(rotation_requested_at, $now)
      WHERE id = $id
          AND user_id = $user_id
          AND source = 'pairing'
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > $now);
    `,
      { user_id: userId, id, now },
    );
  }

  /** Replaces a paired credential in place; only its current hash may rotate. */
  public async replaceHash(
    currentHash: string,
    replacementHash: string,
    now: number,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
      UPDATE personal_agent_tokens
      SET token_hash = $replacement,
          previous_token_hash = $current,
          previous_valid_until = $now + 300000,
          rotated_at = $now,
          rotation_requested_at = NULL
      WHERE token_hash = $current
          AND source = 'pairing'
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > $now)
      RETURNING id;
    `,
      { current: currentHash, replacement: replacementHash, now },
    );
    return rows.length === 1;
  }
}

function nullableTimestamp(timestamp: string | null): number | null {
  return timestamp === null ? null : Number(timestamp);
}
