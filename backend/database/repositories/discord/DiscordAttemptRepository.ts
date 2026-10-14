import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { DatabaseValue } from "@/backend/database/Database";
import type { DiscordDatabase } from "@/backend/database/repositories/discord/DiscordDatabase";
import type { DiscordAttemptFailure } from "@/definition/Discord";

/** Where a stored connection attempt stands; expiry is derived from its time. */
export type StoredAttemptStatus =
  "pending" | "authorized" | "failed" | "confirmed" | "cancelled";

/** A stored connection attempt, including the hash that only the server knows. */
export interface DiscordAttemptRecord {
  readonly id: string;
  readonly stateHash: string;
  readonly projectId: string;
  readonly userId: string;
  readonly baseUrl: string;
  readonly status: StoredAttemptStatus;
  readonly failure: DiscordAttemptFailure | null;
  readonly guildId: string | null;
  readonly guildName: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
}

/** What starting an attempt writes. */
export interface NewDiscordAttempt {
  readonly id: string;
  readonly stateHash: string;
  readonly projectId: string;
  readonly userId: string;
  readonly baseUrl: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** The persistence the Discord services use for connection attempts. */
export interface DiscordAttemptStore {
  /** Stores a new attempt and cancels the open ones of the same user and project. */
  insertAttempt(attempt: NewDiscordAttempt): Promise<void>;
  findAttempt(id: string): Promise<DiscordAttemptRecord | null>;
  findAttemptByStateHash(
    stateHash: string,
  ): Promise<DiscordAttemptRecord | null>;
  /** Returns the newest attempt of a user for a project, whatever its status. */
  findLatestAttempt(
    projectId: string,
    userId: string,
  ): Promise<DiscordAttemptRecord | null>;
  /**
   * Uses the state of a waiting attempt exactly once.
   *
   * @returns The attempt, or `null` when the state is unknown, already used,
   * expired or its attempt no longer waits.
   */
  claimByStateHash(
    stateHash: string,
    now: string,
  ): Promise<DiscordAttemptRecord | null>;
  /**
   * Stores the verified server of an attempt whose state was claimed.
   *
   * @returns Whether it was stored; `false` when the attempt was cancelled or
   * replaced while Discord was still being asked.
   */
  recordAuthorization(
    id: string,
    guild: { readonly id: string; readonly name: string },
  ): Promise<boolean>;
  /** Ends a claimed attempt with the reason; `false` when it was cancelled meanwhile. */
  recordFailure(id: string, failure: DiscordAttemptFailure): Promise<boolean>;
  /** Marks an authorized, unexpired attempt as confirmed; returns whether it was. */
  confirm(id: string, now: string): Promise<boolean>;
  cancel(id: string): Promise<void>;
  deleteExpired(before: string): Promise<void>;
}

const ATTEMPT_COLUMNS = `
            id,
            state_hash,
            project_id,
            user_id,
            base_url,
            status,
            failure,
            guild_id,
            guild_name,
            created_at,
            expires_at,
            consumed_at`;

const STATUSES: readonly StoredAttemptStatus[] = [
  "pending",
  "authorized",
  "failed",
  "confirmed",
  "cancelled",
];

const FAILURES: readonly DiscordAttemptFailure[] = [
  "denied",
  "no_guild",
  "verification_failed",
  "exchange_failed",
];

function toStatus(value: string): StoredAttemptStatus {
  const status = STATUSES.find((candidate) => candidate === value);

  if (!status) {
    throw new Error('Database returned an invalid value for "status".');
  }

  return status;
}

function toFailure(value: string | null): DiscordAttemptFailure | null {
  if (value === null) {
    return null;
  }

  return FAILURES.find((candidate) => candidate === value) ?? null;
}

function toAttempt(row: readonly DatabaseValue[]): DiscordAttemptRecord {
  return {
    baseUrl: readTextColumn(row, 4, "base_url"),
    consumedAt: readNullableTextColumn(row, 11, "consumed_at"),
    createdAt: readTextColumn(row, 9, "created_at"),
    expiresAt: readTextColumn(row, 10, "expires_at"),
    failure: toFailure(readNullableTextColumn(row, 6, "failure")),
    guildId: readNullableTextColumn(row, 7, "guild_id"),
    guildName: readNullableTextColumn(row, 8, "guild_name"),
    id: readTextColumn(row, 0, "id"),
    projectId: readTextColumn(row, 2, "project_id"),
    stateHash: readTextColumn(row, 1, "state_hash"),
    status: toStatus(readTextColumn(row, 5, "status")),
    userId: readTextColumn(row, 3, "user_id"),
  };
}

/** Establishes the persistence boundary for Discord connection attempts. */
export class DiscordAttemptRepository implements DiscordAttemptStore {
  private readonly database: DiscordDatabase;

  /**
   * Creates a Discord attempt repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: DiscordDatabase) {
    this.database = database;
  }

  /** Stores a new attempt and cancels the open ones of the same user and project. */
  public async insertAttempt(attempt: NewDiscordAttempt): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
          UPDATE discord_connection_attempts
          SET status = 'cancelled'
          WHERE project_id = $project_id
              AND user_id = $user_id
              AND status IN ('pending', 'authorized');
        `,
        { project_id: attempt.projectId, user_id: attempt.userId },
      );
      await transaction.execute(
        `
          INSERT INTO discord_connection_attempts (
              id,
              state_hash,
              project_id,
              user_id,
              base_url,
              status,
              created_at,
              expires_at
          )
          VALUES (
              $id,
              $state_hash,
              $project_id,
              $user_id,
              $base_url,
              'pending',
              $created_at,
              $expires_at
          );
        `,
        {
          base_url: attempt.baseUrl,
          created_at: attempt.createdAt,
          expires_at: attempt.expiresAt,
          id: attempt.id,
          project_id: attempt.projectId,
          state_hash: attempt.stateHash,
          user_id: attempt.userId,
        },
      );
    });
  }

  /** Returns an attempt by its public identifier. */
  public async findAttempt(id: string): Promise<DiscordAttemptRecord | null> {
    const rows = await this.database.query(
      `
        SELECT${ATTEMPT_COLUMNS}
        FROM discord_connection_attempts
        WHERE id = $id;
      `,
      { id },
    );
    const row = rows[0];

    return row ? toAttempt(row) : null;
  }

  /** Returns an attempt by the hash of its OAuth state. */
  public async findAttemptByStateHash(
    stateHash: string,
  ): Promise<DiscordAttemptRecord | null> {
    const rows = await this.database.query(
      `
        SELECT${ATTEMPT_COLUMNS}
        FROM discord_connection_attempts
        WHERE state_hash = $state_hash;
      `,
      { state_hash: stateHash },
    );
    const row = rows[0];

    return row ? toAttempt(row) : null;
  }

  /** Returns the newest attempt of a user for a project, whatever its status. */
  public async findLatestAttempt(
    projectId: string,
    userId: string,
  ): Promise<DiscordAttemptRecord | null> {
    const rows = await this.database.query(
      `
        SELECT${ATTEMPT_COLUMNS}
        FROM discord_connection_attempts
        WHERE project_id = $project_id
            AND user_id = $user_id
        ORDER BY created_at DESC
        LIMIT 1;
      `,
      { project_id: projectId, user_id: userId },
    );
    const row = rows[0];

    return row ? toAttempt(row) : null;
  }

  /** Uses the state of a waiting attempt exactly once. */
  public async claimByStateHash(
    stateHash: string,
    now: string,
  ): Promise<DiscordAttemptRecord | null> {
    const rows = await this.database.query(
      `
        UPDATE discord_connection_attempts
        SET consumed_at = $now
        WHERE state_hash = $state_hash
            AND status = 'pending'
            AND consumed_at IS NULL
            AND expires_at > $now
        RETURNING${ATTEMPT_COLUMNS};
      `,
      { now, state_hash: stateHash },
    );
    const row = rows[0];

    return row ? toAttempt(row) : null;
  }

  /** Stores the server that Pages verified for an attempt that is still being answered. */
  public async recordAuthorization(
    id: string,
    guild: { readonly id: string; readonly name: string },
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE discord_connection_attempts
        SET
            status = 'authorized',
            guild_id = $guild_id,
            guild_name = $guild_name
        WHERE id = $id
            AND status = 'pending'
            AND consumed_at IS NOT NULL
        RETURNING id;
      `,
      { guild_id: guild.id, guild_name: guild.name, id },
    );

    return rows.length > 0;
  }

  /** Ends an attempt that is still being answered with the reason Discord's side did not succeed. */
  public async recordFailure(
    id: string,
    failure: DiscordAttemptFailure,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE discord_connection_attempts
        SET
            status = 'failed',
            failure = $failure
        WHERE id = $id
            AND status = 'pending'
            AND consumed_at IS NOT NULL
        RETURNING id;
      `,
      { failure, id },
    );

    return rows.length > 0;
  }

  /** Marks an authorized, unexpired attempt as confirmed; returns whether it was. */
  public async confirm(id: string, now: string): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE discord_connection_attempts
        SET status = 'confirmed'
        WHERE id = $id
            AND status = 'authorized'
            AND expires_at > $now
        RETURNING id;
      `,
      { id, now },
    );

    return rows.length > 0;
  }

  /** Ends an attempt the person abandoned. */
  public async cancel(id: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE discord_connection_attempts
        SET status = 'cancelled'
        WHERE id = $id
            AND status IN ('pending', 'authorized');
      `,
      { id },
    );
  }

  /** Removes attempts that expired before the given time. */
  public async deleteExpired(before: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM discord_connection_attempts WHERE expires_at < $before;",
      { before },
    );
  }
}
