import {
  readBooleanColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import { PersonalAgentTokenRepository } from "./PersonalAgentTokenRepository";
import { PairingPreferenceRepository } from "./PairingPreferenceRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { McpPairingStatus } from "@/definition/McpPairing";

/** Hashed authorization state, kept entirely on the server. */
export interface StoredPairingRequest {
  readonly id: string;
  readonly codeHash: string;
  readonly secretHash: string;
  readonly clientName: string;
  readonly device: string;
  readonly packageVersion: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly status: McpPairingStatus;
  readonly userId: string | null;
  readonly decidedAt: number | null;
  readonly name: string | null;
  readonly validitySeconds: number | null;
  readonly csrfHash: string | null;
  readonly lastPollAt: number | null;
  readonly pollInterval: number;
}

/** Serializes approval and one-time issuance with token persistence on the same connection. */
export class PairingRepository {
  private readonly database: Pick<
    Database,
    "query" | "execute" | "transaction"
  >;

  public constructor(
    database: Pick<Database, "query" | "execute" | "transaction">,
  ) {
    this.database = database;
  }

  /** Runs state changes and credential creation in one transaction. */
  public async transaction<Result>(
    work: (repository: PairingRepository) => Promise<Result>,
  ): Promise<Result> {
    return this.database.transaction((scope) =>
      work(
        new PairingRepository({
          ...scope,
          transaction: async <Nested>(
            operation: (transaction: DatabaseTransaction) => Promise<Nested>,
          ): Promise<Nested> => operation(scope),
        }),
      ),
    );
  }

  /** Shares credential persistence under the current transaction. */
  public tokens(): PersonalAgentTokenRepository {
    return new PersonalAgentTokenRepository(this.database);
  }

  /** Shares validity preferences under the current transaction. */
  public preferences(): PairingPreferenceRepository {
    return new PairingPreferenceRepository(this.database);
  }

  /** Saves hashes only; no human code or device secret enters SQL. */
  public async insert(request: StoredPairingRequest): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO mcp_pairing_requests (
          id, user_code_hash, device_secret_hash, client_name, device_label,
          package_version, created_at, expires_at, status
      ) VALUES ($id, $code, $secret, $client, $device, $version, $created, $expires, 'pending');
    `,
      {
        id: request.id,
        code: request.codeHash,
        secret: request.secretHash,
        client: request.clientName,
        device: request.device,
        version: request.packageVersion,
        created: request.createdAt,
        expires: request.expiresAt,
      },
    );
  }

  /** Reads a hashed code's state without granting authority to it. */
  public async find(codeHash: string): Promise<StoredPairingRequest | null> {
    const rows = await this.database.query(
      `
      SELECT
          id,
          device_secret_hash,
          client_name,
          device_label,
          package_version,
          CAST(created_at AS TEXT),
          CAST(expires_at AS TEXT),
          status,
          user_id,
          CAST(decided_at AS TEXT),
          approved_name,
          CAST(approved_validity_seconds AS TEXT),
          csrf_hash,
          CAST(last_poll_at AS TEXT),
          CAST(poll_interval AS TEXT)
      FROM mcp_pairing_requests
      WHERE user_code_hash = $code;
    `,
      { code: codeHash },
    );
    const row = rows[0];
    if (!row) return null;
    const status = readTextColumn(row, 7, "status");
    if (
      status !== "pending" &&
      status !== "approved" &&
      status !== "denied" &&
      status !== "cancelled" &&
      status !== "consumed" &&
      status !== "expired"
    )
      throw new Error("Invalid stored pairing state.");
    return {
      id: readTextColumn(row, 0, "id"),
      codeHash,
      secretHash: readTextColumn(row, 1, "device_secret_hash"),
      clientName: readTextColumn(row, 2, "client_name"),
      device: readTextColumn(row, 3, "device_label"),
      packageVersion: readTextColumn(row, 4, "package_version"),
      createdAt: Number(readTextColumn(row, 5, "created_at")),
      expiresAt: Number(readTextColumn(row, 6, "expires_at")),
      status,
      userId: readNullableTextColumn(row, 8, "user_id"),
      decidedAt: timestamp(readNullableTextColumn(row, 9, "decided_at")),
      name: readNullableTextColumn(row, 10, "approved_name"),
      validitySeconds: timestamp(
        readNullableTextColumn(row, 11, "approved_validity_seconds"),
      ),
      csrfHash: readNullableTextColumn(row, 12, "csrf_hash"),
      lastPollAt: timestamp(readNullableTextColumn(row, 13, "last_poll_at")),
      pollInterval: Number(readTextColumn(row, 14, "poll_interval")),
    };
  }

  /** Records the session-bound nonce for the pending browser form. */
  public async bind(
    id: string,
    csrfHash: string,
    userId: string,
  ): Promise<void> {
    await this.database.execute(
      "UPDATE mcp_pairing_requests SET csrf_hash = $csrf, user_id = $user_id WHERE id = $id AND status = 'pending';",
      { id, csrf: csrfHash, user_id: userId },
    );
  }

  /** Records an explicit decision without issuing a credential. */
  public async decide(request: StoredPairingRequest): Promise<void> {
    await this.database.execute(
      `
      UPDATE mcp_pairing_requests
      SET status = $status,
          user_id = $user_id,
          decided_at = $decided,
          approved_name = $name,
          approved_validity_seconds = $validity,
          expires_at = $expires,
          csrf_hash = NULL
      WHERE id = $id
          AND status = 'pending';
    `,
      {
        id: request.id,
        status: request.status,
        user_id: request.userId,
        decided: request.decidedAt,
        name: request.name,
        validity: request.validitySeconds,
        expires: request.expiresAt,
      },
    );
  }

  /** Marks consumption or cancellation; a consumed request cannot be cancelled. */
  public async complete(
    id: string,
    status: "consumed" | "cancelled" | "expired",
    tokenId: string | null = null,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE mcp_pairing_requests
      SET status = $status,
          token_id = $token,
          csrf_hash = NULL
      WHERE id = $id
          AND status IN ('pending', 'approved');
    `,
      { id, status, token: tokenId },
    );
  }

  /** Persists polling cadence even when a too-early poll is rejected. */
  public async poll(id: string, now: number, interval: number): Promise<void> {
    await this.database.execute(
      "UPDATE mcp_pairing_requests SET last_poll_at = $now, poll_interval = $interval WHERE id = $id;",
      { id, now, interval },
    );
  }

  /** Checks account eligibility inside the issuance transaction. */
  public async account(userId: string): Promise<{
    displayName: string;
    username: string;
    isEligible: boolean;
  } | null> {
    const rows = await this.database.query(
      `
      SELECT
          display_name,
          username,
          is_active,
          must_change_password
      FROM users
      WHERE id = $user_id;
    `,
      { user_id: userId },
    );
    const row = rows[0];
    return row
      ? {
          displayName: readTextColumn(row, 0, "display_name"),
          username: readTextColumn(row, 1, "username"),
          isEligible:
            readBooleanColumn(row, 2, "is_active") &&
            !readBooleanColumn(row, 3, "must_change_password"),
        }
      : null;
  }

  /** Prunes old requests and counts still-open requests, including those surviving a restart. */
  public async maintain(now: number): Promise<number> {
    await this.database.execute(
      "DELETE FROM mcp_pairing_requests WHERE expires_at < $threshold;",
      { threshold: now - 86_400_000 },
    );
    const rows = await this.database.query(
      `
      SELECT CAST(COUNT(*) AS TEXT)
      FROM mcp_pairing_requests
      WHERE status IN ('pending', 'approved')
          AND expires_at > $now;
    `,
      { now },
    );
    return Number(readTextColumn(rows[0], 0, "count"));
  }
}

function timestamp(input: string | null): number | null {
  return input === null ? null : Number(input);
}
