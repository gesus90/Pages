import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Persisted OAuth credential; the secret itself is never stored. */
export interface OAuthCredential {
  readonly tokenHash: string;
  readonly grantId: string;
  readonly kind: "code" | "access" | "refresh" | "delegation";
  readonly audience: string;
  readonly expiresAt: number;
  readonly usedAt: number | null;
  readonly parameters: string;
}

/** Stores separate audiences and retains consumed credentials for refresh replay detection. */
export class OAuthCredentialRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Stores a generated credential hash and its originating consent. */
  public async insert(credential: OAuthCredential): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO mcp_oauth_credentials (
          token_hash, grant_id, kind, audience, expires_at, parameters
      ) VALUES ($token_hash, $grant_id, $kind, $audience, $expires_at, $parameters);
    `,
      {
        token_hash: credential.tokenHash,
        grant_id: credential.grantId,
        kind: credential.kind,
        audience: credential.audience,
        expires_at: credential.expiresAt,
        parameters: credential.parameters,
      },
    );
  }

  /** Loads one credential of the requested kind, preventing cross-token use. */
  public async find(
    tokenHash: string,
    kind: OAuthCredential["kind"],
  ): Promise<OAuthCredential | null> {
    const rows = await this.database.query(
      `
      SELECT
          grant_id,
          audience,
          CAST(expires_at AS TEXT),
          CAST(used_at AS TEXT),
          parameters
      FROM mcp_oauth_credentials
      WHERE token_hash = $token_hash
          AND kind = $kind;
    `,
      { token_hash: tokenHash, kind },
    );
    const row = rows[0];
    if (!row) return null;
    const usedAt = readNullableTextColumn(row, 3, "used_at");
    return {
      tokenHash,
      kind,
      grantId: readTextColumn(row, 0, "grant_id"),
      audience: readTextColumn(row, 1, "audience"),
      expiresAt: Number(readTextColumn(row, 2, "expires_at")),
      usedAt: usedAt === null ? null : Number(usedAt),
      parameters: readTextColumn(row, 4, "parameters"),
    };
  }

  /** Consumes a code or refresh token inside the aggregate transaction. */
  public async consume(tokenHash: string, now: number): Promise<void> {
    await this.database.execute(
      `
      UPDATE mcp_oauth_credentials
      SET used_at = $now
      WHERE token_hash = $token_hash
          AND used_at IS NULL;
    `,
      { token_hash: tokenHash, now },
    );
  }
}
