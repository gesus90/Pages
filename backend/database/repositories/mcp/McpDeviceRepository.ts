import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";
import type { DatabaseValue } from "@/backend/database/Database";

/** A machine that is paired with an account. */
export interface StoredMcpDevice {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly clientVersion: string;
  readonly pairedAt: number;
  readonly lastUsedAt: number | null;
}

/** A paired machine together with the account it acts for. */
export interface McpDeviceAccount extends StoredMcpDevice {
  readonly displayName: string;
  readonly username: string;
}

const DEVICE_COLUMNS = `
          mcp_device.id,
          mcp_device.user_id,
          mcp_device.name,
          mcp_device.client_version,
          CAST(mcp_device.paired_at AS TEXT),
          CAST(mcp_device.last_used_at AS TEXT)`;

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

function readDevice(row: readonly DatabaseValue[]): StoredMcpDevice {
  return {
    id: readTextColumn(row, 0, "id"),
    userId: readTextColumn(row, 1, "user_id"),
    name: readTextColumn(row, 2, "name"),
    clientVersion: readTextColumn(row, 3, "client_version"),
    pairedAt: readMilliseconds(row, 4, "paired_at"),
    lastUsedAt: readOptionalMilliseconds(row, 5, "last_used_at"),
  };
}

/** Stores the paired machines of the stand-alone Pages MCP program; only token hashes are kept. */
export class McpDeviceRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /**
   * Finds the active account behind a token and notes the use in the same statement.
   *
   * @param tokenHash - Hash of the presented token.
   * @param now - Unix milliseconds of the request.
   * @returns The machine and its account, or `null` for an unknown or revoked token, a
   * deactivated or deleted account.
   */
  public async touchByTokenHash(
    tokenHash: string,
    now: number,
  ): Promise<McpDeviceAccount | null> {
    const [row] = await this.database.query(
      `
      WITH used AS (
          UPDATE mcp_device
          SET last_used_at = $now
          FROM users
          WHERE mcp_device.token_hash = $token_hash
              AND mcp_device.revoked_at IS NULL
              AND users.id = mcp_device.user_id
              AND users.is_active = 1
              AND users.account_kind = 'person'
          RETURNING
              mcp_device.id,
              mcp_device.user_id,
              mcp_device.name,
              mcp_device.client_version,
              mcp_device.paired_at,
              mcp_device.last_used_at,
              users.display_name,
              users.username
      )
      SELECT
          id,
          user_id,
          name,
          client_version,
          CAST(paired_at AS TEXT),
          CAST(last_used_at AS TEXT),
          display_name,
          username
      FROM used;
    `,
      { token_hash: tokenHash, now },
    );
    if (!row) return null;
    return {
      ...readDevice(row),
      displayName: readTextColumn(row, 6, "display_name"),
      username: readTextColumn(row, 7, "username"),
    };
  }

  /**
   * Revokes the machine of a token.
   *
   * @returns Whether a valid pairing was revoked.
   */
  public async revokeByTokenHash(
    tokenHash: string,
    now: number,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
      UPDATE mcp_device
      SET revoked_at = $now
      WHERE token_hash = $token_hash
          AND revoked_at IS NULL
      RETURNING id;
    `,
      { token_hash: tokenHash, now },
    );
    return rows.length > 0;
  }

  /**
   * Revokes one machine of an account.
   *
   * @returns Whether a valid pairing of this account was revoked.
   */
  public async revokeForUser(
    deviceId: string,
    userId: string,
    now: number,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
      UPDATE mcp_device
      SET revoked_at = $now
      WHERE id = $device_id
          AND user_id = $user_id
          AND revoked_at IS NULL
      RETURNING id;
    `,
      { device_id: deviceId, user_id: userId, now },
    );
    return rows.length > 0;
  }

  /** Lists the active machines of an account, the most recently paired first. */
  public async listForUser(
    userId: string,
  ): Promise<readonly StoredMcpDevice[]> {
    const rows = await this.database.query(
      `
      SELECT ${DEVICE_COLUMNS}
      FROM mcp_device
      WHERE mcp_device.user_id = $user_id
          AND mcp_device.revoked_at IS NULL
      ORDER BY
          mcp_device.paired_at DESC,
          mcp_device.id ASC;
    `,
      { user_id: userId },
    );
    return rows.map(readDevice);
  }
}
