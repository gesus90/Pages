import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Browser authorization process, including its server-side user and CSRF binding. */
export interface OAuthFlow {
  readonly id: string;
  readonly parameters: string;
  readonly expiresAt: number;
  readonly userId: string | null;
  readonly csrfHash: string | null;
}

/** Persists the 15-minute consent process and atomically closes it once. */
export class OAuthFlowRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Opens an authorization process before the Pages login redirect. */
  public async insert(
    id: string,
    parameters: string,
    expiresAt: number,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO mcp_oauth_flows (id, parameters, expires_at)
      VALUES ($id, $parameters, $expires_at);
    `,
      { id, parameters, expires_at: expiresAt },
    );
  }

  /** Loads an unfinished process; callers enforce its deadline. */
  public async find(id: string): Promise<OAuthFlow | null> {
    const rows = await this.database.query(
      `
      SELECT
          id,
          parameters,
          CAST(expires_at AS TEXT),
          user_id,
          csrf_hash
      FROM mcp_oauth_flows
      WHERE id = $id
          AND completed_at IS NULL;
    `,
      { id },
    );
    const row = rows[0];
    return row
      ? {
          id: readTextColumn(row, 0, "id"),
          parameters: readTextColumn(row, 1, "parameters"),
          expiresAt: Number(readTextColumn(row, 2, "expires_at")),
          userId: readNullableTextColumn(row, 3, "user_id"),
          csrfHash: readNullableTextColumn(row, 4, "csrf_hash"),
        }
      : null;
  }

  /** Binds consent to the current browser session, user and one fresh nonce. */
  public async bind(
    id: string,
    userId: string,
    csrfHash: string,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE mcp_oauth_flows
      SET user_id = $user_id,
          csrf_hash = $csrf_hash
      WHERE id = $id;
    `,
      { id, user_id: userId, csrf_hash: csrfHash },
    );
  }

  /** Closes consent inside the caller's transaction, including rejected requests. */
  public async complete(id: string, now: number): Promise<void> {
    await this.database.execute(
      `
      UPDATE mcp_oauth_flows
      SET completed_at = $now
      WHERE id = $id;
    `,
      { id, now },
    );
  }
}
