import { readTextColumn } from "@/backend/database/RowValue";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

/** The status of a stored pairing request. */
export type McpPairingStatus =
  "pending" | "approved" | "denied" | "cancelled" | "collected";

/** A pairing request as stored; hashes only, never the user code or the secret. */
export interface StoredMcpPairing {
  readonly id: string;
  readonly deviceSecretHash: string;
  readonly deviceName: string;
  readonly clientVersion: string;
  readonly status: McpPairingStatus;
  readonly userId: string | null;
  readonly expiresAt: number;
}

/** What a new pairing request is stored with. */
export interface NewMcpPairing {
  readonly id: string;
  readonly userCodeHash: string;
  readonly deviceSecretHash: string;
  readonly deviceName: string;
  readonly clientVersion: string;
  readonly addressHash: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** How many requests an address may start, and in which window. */
export interface McpPairingLimits {
  readonly startsPerWindow: number;
  readonly windowMs: number;
  readonly openRequests: number;
}

/** The outcome of an attempt to store a request. */
export type McpPairingInsertion =
  | { readonly kind: "stored" }
  | { readonly kind: "limited"; readonly retryAfterMs: number }
  | { readonly kind: "code_taken" };

/** A machine created from a confirmed request. */
export interface NewMcpDeviceFromPairing {
  readonly deviceId: string;
  readonly tokenHash: string;
  readonly pairedAt: number;
}

/** The machine and the account behind a collected pairing. */
export interface CollectedMcpPairing {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly displayName: string;
  readonly username: string;
}

const PAIRING_COLUMNS = `
          id,
          device_secret_hash,
          device_name,
          client_version,
          status,
          user_id,
          CAST(expires_at AS TEXT)`;

/** How long a request that ended stays, so the page can still say what became of its code. */
const RETENTION_MS = 60 * 60 * 1000;

const STATUSES: readonly McpPairingStatus[] = [
  "pending",
  "approved",
  "denied",
  "cancelled",
  "collected",
];

function readStatus(text: string): McpPairingStatus {
  const status = STATUSES.find((candidate) => candidate === text);
  if (status === undefined)
    throw new Error('Database returned an invalid value for "status".');
  return status;
}

function readPairing(row: readonly DatabaseValue[]): StoredMcpPairing {
  const userId = row[5];
  return {
    id: readTextColumn(row, 0, "id"),
    deviceSecretHash: readTextColumn(row, 1, "device_secret_hash"),
    deviceName: readTextColumn(row, 2, "device_name"),
    clientVersion: readTextColumn(row, 3, "client_version"),
    status: readStatus(readTextColumn(row, 4, "status")),
    userId: userId === null ? null : readTextColumn(row, 5, "user_id"),
    expiresAt: Number(readTextColumn(row, 6, "expires_at")),
  };
}

function readOptionalNumber(
  row: readonly DatabaseValue[] | undefined,
  index: number,
): number | null {
  const value = row?.[index];
  return typeof value === "string" ? Number(value) : null;
}

/** Stores the open pairing requests of machines and turns a confirmed one into a paired machine. */
export class McpDevicePairingRepository {
  private readonly database: Pick<
    Database,
    "query" | "execute" | "transaction"
  >;

  public constructor(
    database: Pick<Database, "query" | "execute" | "transaction">,
  ) {
    this.database = database;
  }

  /**
   * Stores a request unless its address reached a limit.
   *
   * @param pairing - The request with the hashes of its code, secret and address.
   * @param limits - Starts per window and open requests per address.
   * @returns Whether the request was stored, the address has to wait, or the code exists already.
   *
   * @remarks
   * Counting and storing run in one transaction of the single writer, so two
   * simultaneous starts cannot both pass the last free place. Requests that
   * ended long ago are deleted here; recent ones stay so the page can still
   * say what became of a code.
   */
  public async insertWithinLimits(
    pairing: NewMcpPairing,
    limits: McpPairingLimits,
  ): Promise<McpPairingInsertion> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
        DELETE FROM mcp_device_pairing
        WHERE expires_at < $threshold;
      `,
        { threshold: pairing.createdAt - RETENTION_MS },
      );
      const [recent] = await transaction.query(
        `
        SELECT
            COUNT(*),
            CAST(MIN(created_at) AS TEXT)
        FROM mcp_device_pairing
        WHERE address_hash = $address_hash
            AND created_at > $window_start;
      `,
        {
          address_hash: pairing.addressHash,
          window_start: pairing.createdAt - limits.windowMs,
        },
      );
      const startCount = Number(recent?.[0] ?? 0);
      const oldestStart = readOptionalNumber(recent, 1);
      if (startCount >= limits.startsPerWindow && oldestStart !== null)
        return {
          kind: "limited",
          retryAfterMs: oldestStart + limits.windowMs - pairing.createdAt,
        };
      const [open] = await transaction.query(
        `
        SELECT
            COUNT(*),
            CAST(MIN(expires_at) AS TEXT)
        FROM mcp_device_pairing
        WHERE address_hash = $address_hash
            AND status = 'pending'
            AND expires_at > $now;
      `,
        { address_hash: pairing.addressHash, now: pairing.createdAt },
      );
      const openCount = Number(open?.[0] ?? 0);
      const firstExpiry = readOptionalNumber(open, 1);
      if (openCount >= limits.openRequests && firstExpiry !== null)
        return {
          kind: "limited",
          retryAfterMs: firstExpiry - pairing.createdAt,
        };
      return this.insert(transaction, pairing);
    });
  }

  /** Finds a request by the hash of its user code. */
  public async findByCodeHash(
    userCodeHash: string,
  ): Promise<StoredMcpPairing | null> {
    const [row] = await this.database.query(
      `
      SELECT ${PAIRING_COLUMNS}
      FROM mcp_device_pairing
      WHERE user_code_hash = $user_code_hash;
    `,
      { user_code_hash: userCodeHash },
    );
    return row ? readPairing(row) : null;
  }

  /**
   * Notes a result query unless the last one came less than an interval ago.
   *
   * @returns Whether the query was allowed.
   */
  public async notePoll(
    id: string,
    now: number,
    intervalMs: number,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
      UPDATE mcp_device_pairing
      SET last_polled_at = $polled_at
      WHERE id = $id
          AND (last_polled_at IS NULL OR last_polled_at <= $earliest)
      RETURNING id;
    `,
      { id, polled_at: now, earliest: now - intervalMs },
    );
    return rows.length > 0;
  }

  /**
   * Records the decision of a person on an open request.
   *
   * @returns Whether the request was still open and is now decided.
   */
  public async decide(input: {
    readonly id: string;
    readonly userId: string;
    readonly status: "approved" | "denied";
    readonly now: number;
  }): Promise<boolean> {
    const rows = await this.database.query(
      `
      UPDATE mcp_device_pairing
      SET status = $status,
          user_id = $user_id,
          decided_at = $decided_at
      WHERE id = $id
          AND status = 'pending'
          AND expires_at > $now
      RETURNING id;
    `,
      {
        id: input.id,
        status: input.status,
        user_id: input.userId,
        decided_at: input.now,
        now: input.now,
      },
    );
    return rows.length > 0;
  }

  /**
   * Ends a request that is not collected yet on behalf of the client that started it.
   *
   * @returns Whether an open or confirmed request was cancelled.
   */
  public async cancel(id: string): Promise<boolean> {
    const rows = await this.database.query(
      `
      UPDATE mcp_device_pairing
      SET status = 'cancelled'
      WHERE id = $id
          AND status IN ('pending', 'approved')
      RETURNING id;
    `,
      { id },
    );
    return rows.length > 0;
  }

  /**
   * Turns a confirmed request into a paired machine, exactly once.
   *
   * @param id - The request.
   * @param device - The new machine with the hash of its token.
   * @param now - Unix milliseconds; a request that expired before is not collected.
   * @returns The machine and its account, or `null` when another query collected it first,
   * it is not confirmed, or the account is gone or deactivated.
   *
   * @remarks
   * One statement claims the request and stores the machine, so the token of a
   * request is issued once even for two simultaneous queries.
   */
  public async collect(
    id: string,
    device: NewMcpDeviceFromPairing,
    now: number,
  ): Promise<CollectedMcpPairing | null> {
    const [row] = await this.database.query(
      `
      WITH claimed AS (
          UPDATE mcp_device_pairing
          SET status = 'collected'
          FROM users
          WHERE mcp_device_pairing.id = $id
              AND mcp_device_pairing.status = 'approved'
              AND mcp_device_pairing.expires_at > $now
              AND users.id = mcp_device_pairing.user_id
              AND users.is_active = 1
          RETURNING
              mcp_device_pairing.user_id,
              mcp_device_pairing.device_name,
              mcp_device_pairing.client_version,
              users.display_name,
              users.username
      ),
      created AS (
          INSERT INTO mcp_device (
              id,
              user_id,
              name,
              client_version,
              token_hash,
              paired_at
          )
          SELECT
              CAST($device_id AS TEXT),
              user_id,
              device_name,
              client_version,
              CAST($token_hash AS TEXT),
              CAST($paired_at AS BIGINT)
          FROM claimed
          RETURNING id
      )
      SELECT
          created.id,
          claimed.device_name,
          claimed.display_name,
          claimed.username
      FROM created
      CROSS JOIN claimed;
    `,
      {
        id,
        now,
        device_id: device.deviceId,
        token_hash: device.tokenHash,
        paired_at: device.pairedAt,
      },
    );
    if (!row) return null;
    return {
      deviceId: readTextColumn(row, 0, "id"),
      deviceName: readTextColumn(row, 1, "device_name"),
      displayName: readTextColumn(row, 2, "display_name"),
      username: readTextColumn(row, 3, "username"),
    };
  }

  private async insert(
    transaction: DatabaseTransaction,
    pairing: NewMcpPairing,
  ): Promise<McpPairingInsertion> {
    const [existing] = await transaction.query(
      `
      SELECT id
      FROM mcp_device_pairing
      WHERE user_code_hash = $user_code_hash;
    `,
      { user_code_hash: pairing.userCodeHash },
    );
    if (existing) return { kind: "code_taken" };
    await transaction.execute(
      `
      INSERT INTO mcp_device_pairing (
          id,
          user_code_hash,
          device_secret_hash,
          device_name,
          client_version,
          address_hash,
          status,
          created_at,
          expires_at
      ) VALUES (
          $id,
          $user_code_hash,
          $device_secret_hash,
          $device_name,
          $client_version,
          $address_hash,
          'pending',
          $created_at,
          $expires_at
      );
    `,
      {
        id: pairing.id,
        user_code_hash: pairing.userCodeHash,
        device_secret_hash: pairing.deviceSecretHash,
        device_name: pairing.deviceName,
        client_version: pairing.clientVersion,
        address_hash: pairing.addressHash,
        created_at: pairing.createdAt,
        expires_at: pairing.expiresAt,
      },
    );
    return { kind: "stored" };
  }
}
