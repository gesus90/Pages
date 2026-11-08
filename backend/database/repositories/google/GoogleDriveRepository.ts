import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database, DatabaseValue } from "@/backend/database/Database";

/** The one row id of the instance connection. */
const CONNECTION_ID = "instance";

/** Why a stored connection waits for a new sign-in. */
export type GoogleDriveReauthorizationReason =
  "access_revoked" | "scope_missing" | "account_changed" | "secret_unavailable";

/** A stored sign-in attempt; the verifier is encrypted. */
export interface GoogleDriveSignInAttempt {
  readonly id: string;
  readonly stateHash: string;
  readonly userId: string;
  readonly redirectUri: string;
  readonly codeVerifierSecret: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly consumedAt: number | null;
}

/** The stored connection of the instance; the refresh token is encrypted. */
export interface StoredGoogleDriveConnection {
  readonly googlePermissionId: string;
  readonly googleEmail: string | null;
  readonly refreshTokenSecret: string;
  readonly grantedScope: string;
  readonly connectedByUserId: string;
  readonly connectedAt: number;
  readonly reauthorizationReason: GoogleDriveReauthorizationReason | null;
}

/** What a completed sign-in stores. */
export interface NewGoogleDriveConnection {
  readonly googlePermissionId: string;
  readonly googleEmail: string | null;
  readonly refreshTokenSecret: string;
  readonly grantedScope: string;
  readonly connectedByUserId: string;
  readonly connectedAt: number;
}

const REAUTHORIZATION_REASONS: readonly GoogleDriveReauthorizationReason[] = [
  "access_revoked",
  "scope_missing",
  "account_changed",
  "secret_unavailable",
];

const ATTEMPT_COLUMNS = `
            id,
            state_hash,
            user_id,
            redirect_uri,
            code_verifier_secret,
            CAST(created_at AS TEXT),
            CAST(expires_at AS TEXT),
            CAST(consumed_at AS TEXT)`;

function readMilliseconds(
  row: readonly DatabaseValue[],
  index: number,
  column: string,
): number {
  return Number(readTextColumn(row, index, column));
}

function readOptionalMilliseconds(
  row: readonly DatabaseValue[],
  index: number,
  column: string,
): number | null {
  return row[index] === null ? null : readMilliseconds(row, index, column);
}

function toReason(
  value: string | null,
): GoogleDriveReauthorizationReason | null {
  return REAUTHORIZATION_REASONS.find((reason) => reason === value) ?? null;
}

function toAttempt(row: readonly DatabaseValue[]): GoogleDriveSignInAttempt {
  return {
    codeVerifierSecret: readTextColumn(row, 4, "code_verifier_secret"),
    consumedAt: readOptionalMilliseconds(row, 7, "consumed_at"),
    createdAt: readMilliseconds(row, 5, "created_at"),
    expiresAt: readMilliseconds(row, 6, "expires_at"),
    id: readTextColumn(row, 0, "id"),
    redirectUri: readTextColumn(row, 3, "redirect_uri"),
    stateHash: readTextColumn(row, 1, "state_hash"),
    userId: readTextColumn(row, 2, "user_id"),
  };
}

function toConnection(
  row: readonly DatabaseValue[],
): StoredGoogleDriveConnection {
  return {
    connectedAt: readMilliseconds(row, 5, "connected_at"),
    connectedByUserId: readTextColumn(row, 4, "connected_by_user_id"),
    googleEmail: readNullableTextColumn(row, 1, "google_email"),
    googlePermissionId: readTextColumn(row, 0, "google_permission_id"),
    grantedScope: readTextColumn(row, 3, "granted_scope"),
    reauthorizationReason: toReason(
      readNullableTextColumn(row, 6, "reauthorization_reason"),
    ),
    refreshTokenSecret: readTextColumn(row, 2, "refresh_token_secret"),
  };
}

/** Stores the Google Drive connection of the instance and its sign-in attempts. */
export class GoogleDriveRepository {
  private readonly database: Pick<
    Database,
    "execute" | "query" | "transaction"
  >;

  /**
   * Creates the repository.
   *
   * @param database - Central database access.
   */
  public constructor(
    database: Pick<Database, "execute" | "query" | "transaction">,
  ) {
    this.database = database;
  }

  /**
   * Stores a new sign-in attempt and drops the expired ones.
   *
   * @param attempt - The attempt without its consumption time.
   */
  public async insertAttempt(
    attempt: Omit<GoogleDriveSignInAttempt, "consumedAt">,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        "DELETE FROM google_drive_sign_in_attempt WHERE expires_at < $now;",
        { now: attempt.createdAt },
      );
      await transaction.execute(
        `
          INSERT INTO google_drive_sign_in_attempt (
              id,
              state_hash,
              user_id,
              redirect_uri,
              code_verifier_secret,
              created_at,
              expires_at
          )
          VALUES (
              $id,
              $state_hash,
              $user_id,
              $redirect_uri,
              $code_verifier_secret,
              $created_at,
              $expires_at
          );
        `,
        {
          code_verifier_secret: attempt.codeVerifierSecret,
          created_at: attempt.createdAt,
          expires_at: attempt.expiresAt,
          id: attempt.id,
          redirect_uri: attempt.redirectUri,
          state_hash: attempt.stateHash,
          user_id: attempt.userId,
        },
      );
    });
  }

  /**
   * Uses the state of an open attempt of one account exactly once.
   *
   * @param input - Hash of the state, the signed-in account and the time.
   * @returns The attempt, or `null` when the state is unknown, used, expired
   * or belongs to another account.
   */
  public async claimAttempt(input: {
    readonly stateHash: string;
    readonly userId: string;
    readonly now: number;
  }): Promise<GoogleDriveSignInAttempt | null> {
    const [row] = await this.database.query(
      `
        UPDATE google_drive_sign_in_attempt
        SET consumed_at = $now
        WHERE state_hash = $state_hash
            AND user_id = $user_id
            AND consumed_at IS NULL
            AND expires_at > $now
        RETURNING${ATTEMPT_COLUMNS};
      `,
      { now: input.now, state_hash: input.stateHash, user_id: input.userId },
    );

    return row ? toAttempt(row) : null;
  }

  /**
   * Returns an attempt by the hash of its state, whatever its status.
   *
   * @param stateHash - Hash of the state the callback named.
   * @returns The attempt, or `null`.
   */
  public async findAttemptByStateHash(
    stateHash: string,
  ): Promise<GoogleDriveSignInAttempt | null> {
    const [row] = await this.database.query(
      `
        SELECT${ATTEMPT_COLUMNS}
        FROM google_drive_sign_in_attempt
        WHERE state_hash = $state_hash;
      `,
      { state_hash: stateHash },
    );

    return row ? toAttempt(row) : null;
  }

  /** Returns the stored connection of the instance, or `null`. */
  public async findConnection(): Promise<StoredGoogleDriveConnection | null> {
    const [row] = await this.database.query(
      `
        SELECT
            google_permission_id,
            google_email,
            refresh_token_secret,
            granted_scope,
            connected_by_user_id,
            CAST(connected_at AS TEXT),
            reauthorization_reason
        FROM google_drive_connection
        WHERE id = $id;
      `,
      { id: CONNECTION_ID },
    );

    return row ? toConnection(row) : null;
  }

  /**
   * Stores the connection of a completed sign-in, replacing the previous one.
   *
   * @param connection - Account, encrypted refresh token, scope and administrator.
   */
  public async saveConnection(
    connection: NewGoogleDriveConnection,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO google_drive_connection (
            id,
            google_permission_id,
            google_email,
            refresh_token_secret,
            granted_scope,
            connected_by_user_id,
            connected_at,
            reauthorization_reason,
            last_refreshed_at,
            last_verified_at
        )
        VALUES (
            $id,
            $google_permission_id,
            $google_email,
            $refresh_token_secret,
            $granted_scope,
            $connected_by_user_id,
            $connected_at,
            NULL,
            NULL,
            $connected_at
        )
        ON CONFLICT (id) DO UPDATE
        SET
            google_permission_id = EXCLUDED.google_permission_id,
            google_email = EXCLUDED.google_email,
            refresh_token_secret = EXCLUDED.refresh_token_secret,
            granted_scope = EXCLUDED.granted_scope,
            connected_by_user_id = EXCLUDED.connected_by_user_id,
            connected_at = EXCLUDED.connected_at,
            reauthorization_reason = NULL,
            last_refreshed_at = NULL,
            last_verified_at = EXCLUDED.last_verified_at;
      `,
      {
        connected_at: connection.connectedAt,
        connected_by_user_id: connection.connectedByUserId,
        google_email: connection.googleEmail,
        google_permission_id: connection.googlePermissionId,
        granted_scope: connection.grantedScope,
        id: CONNECTION_ID,
        refresh_token_secret: connection.refreshTokenSecret,
      },
    );
  }

  /**
   * Notes a renewal of the access token, and a new refresh token when Google sent one.
   *
   * @param input - The connection it renewed, the time and the optional new refresh token.
   * @returns Whether the row still belongs to that connection; a sign-in in the
   * meantime replaced it.
   */
  public async recordRefresh(input: {
    readonly connectedAt: number;
    readonly now: number;
    readonly refreshTokenSecret: string | null;
  }): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE google_drive_connection
        SET
            last_refreshed_at = $now,
            refresh_token_secret = COALESCE($refresh_token_secret, refresh_token_secret)
        WHERE id = $id
            AND connected_at = $connected_at
        RETURNING id;
      `,
      {
        connected_at: input.connectedAt,
        id: CONNECTION_ID,
        now: input.now,
        refresh_token_secret: input.refreshTokenSecret,
      },
    );

    return rows.length > 0;
  }

  /**
   * Notes a successful Drive request and keeps the address Drive named.
   *
   * @param input - The connection it confirmed, the time and the address.
   */
  public async recordVerification(input: {
    readonly connectedAt: number;
    readonly now: number;
    readonly googleEmail: string | null;
  }): Promise<void> {
    await this.database.execute(
      `
        UPDATE google_drive_connection
        SET
            last_verified_at = $now,
            google_email = $google_email
        WHERE id = $id
            AND connected_at = $connected_at
            AND reauthorization_reason IS NULL;
      `,
      {
        connected_at: input.connectedAt,
        google_email: input.googleEmail,
        id: CONNECTION_ID,
        now: input.now,
      },
    );
  }

  /**
   * Marks the connection as waiting for a new sign-in.
   *
   * @param input - The connection Google refused and why.
   */
  public async requireReauthorization(input: {
    readonly connectedAt: number;
    readonly reason: GoogleDriveReauthorizationReason;
  }): Promise<void> {
    await this.database.execute(
      `
        UPDATE google_drive_connection
        SET reauthorization_reason = $reason
        WHERE id = $id
            AND connected_at = $connected_at;
      `,
      {
        connected_at: input.connectedAt,
        id: CONNECTION_ID,
        reason: input.reason,
      },
    );
  }
}
