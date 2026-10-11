import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Owner-bound consent with an absolute re-verification deadline. */
export interface OAuthGrant {
  readonly id: string;
  readonly userId: string;
  readonly clientId: string;
  readonly resource: string;
  readonly verifiedAt: number;
  readonly expiresAt: number | null;
  readonly status: string;
}

/** Stores consent lifetime and terminal states; settings never resurrect ended grants. */
export class OAuthGrantRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Creates an explicit consent, using the current owner preference. */
  public async insert(grant: OAuthGrant): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO mcp_oauth_grants (
          id, user_id, client_id, resource, verified_at, expires_at, status
      ) VALUES ($id, $user_id, $client_id, $resource, $verified_at, $expires_at, 'active');
    `,
      {
        id: grant.id,
        user_id: grant.userId,
        client_id: grant.clientId,
        resource: grant.resource,
        verified_at: grant.verifiedAt,
        expires_at: grant.expiresAt,
      },
    );
  }

  /** Returns consent facts, including ended grants for reuse detection. */
  public async find(id: string): Promise<OAuthGrant | null> {
    const rows = await this.database.query(
      `
      SELECT
          id,
          user_id,
          client_id,
          resource,
          CAST(verified_at AS TEXT),
          CAST(expires_at AS TEXT),
          status
      FROM mcp_oauth_grants
      WHERE id = $id;
    `,
      { id },
    );
    const row = rows[0];
    if (!row) return null;
    const expiresAt = readNullableTextColumn(row, 5, "expires_at");
    return {
      id: readTextColumn(row, 0, "id"),
      userId: readTextColumn(row, 1, "user_id"),
      clientId: readTextColumn(row, 2, "client_id"),
      resource: readTextColumn(row, 3, "resource"),
      verifiedAt: Number(readTextColumn(row, 4, "verified_at")),
      expiresAt: expiresAt === null ? null : Number(expiresAt),
      status: readTextColumn(row, 6, "status"),
    };
  }

  /** Lists consent identifiers for the requesting owner only. */
  public async listIds(userId: string): Promise<string[]> {
    const rows = await this.database.query(
      `
      SELECT id
      FROM mcp_oauth_grants
      WHERE user_id = $user_id
      ORDER BY verified_at DESC;
    `,
      { user_id: userId },
    );
    return rows.map((row) => readTextColumn(row, 0, "id"));
  }

  /** Records a terminal status without reactivating an ended consent. */
  public async end(
    id: string,
    status: "expired" | "revoked",
    now: number,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE mcp_oauth_grants
      SET status = $status,
          ended_at = $now
      WHERE id = $id
          AND status = 'active';
    `,
      { id, status, now },
    );
  }

  /** Reads the owner's duration; a missing preference defaults to one day. */
  public async duration(userId: string): Promise<number | null> {
    const rows = await this.database.query(
      `
      SELECT CAST(duration_seconds AS TEXT)
      FROM mcp_oauth_preferences
      WHERE user_id = $user_id;
    `,
      { user_id: userId },
    );
    if (!rows[0]) return 86_400;
    const duration = readNullableTextColumn(rows[0], 0, "duration_seconds");
    return duration === null ? null : Number(duration);
  }

  /** Applies the new duration to active grants after expiring them under the old rule. */
  public async setDuration(
    userId: string,
    duration: number | null,
    now: number,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE mcp_oauth_grants
      SET status = 'expired',
          ended_at = $now
      WHERE user_id = $user_id
          AND status = 'active'
          AND expires_at <= $now;
    `,
      { user_id: userId, now },
    );
    await this.database.execute(
      `
      INSERT INTO mcp_oauth_preferences (user_id, duration_seconds)
      VALUES ($user_id, $duration)
      ON CONFLICT (user_id) DO UPDATE SET duration_seconds = excluded.duration_seconds;
    `,
      { user_id: userId, duration },
    );
    await this.database.execute(
      `
      UPDATE mcp_oauth_grants
      SET expires_at = CASE WHEN $duration IS NULL THEN NULL ELSE verified_at + $duration * 1000 END
      WHERE user_id = $user_id
          AND status = 'active';
    `,
      { user_id: userId, duration },
    );
    await this.database.execute(
      `
      UPDATE mcp_oauth_grants
      SET status = 'expired',
          ended_at = $now
      WHERE user_id = $user_id
          AND status = 'active'
          AND expires_at <= $now;
    `,
      { user_id: userId, now },
    );
  }
}
