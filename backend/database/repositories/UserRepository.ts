import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";
import type { Role } from "@/definition/Role";
import type { User } from "@/definition/User";
import type { DuckDBValue } from "@duckdb/node-api";

/** A user together with the credentials required for authentication. */
export interface UserCredentials {
  readonly user: User;
  readonly passwordHash: string;
}

/** Values required to persist a new user. */
export interface NewUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly role: Role;
}

/** Owns persistence operations for users. */
export class UserRepository {
  private readonly database: Database;

  /**
   * Creates a user repository.
   *
   * @param database - Central DuckDB access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Returns whether the application contains at least one user. */
  public async hasUsers(): Promise<boolean> {
    const rows = await this.database.query(`
      SELECT
          COUNT(id) AS user_count
      FROM users;
    `);
    const row = rows[0];

    if (!row) {
      throw new Error("Database returned no user count.");
    }

    return readCountColumn(row, 0, "user_count") > 0;
  }

  /**
   * Returns the user with the given identifier.
   *
   * @param id - User identifier.
   * @returns The user, or `null` when no user exists.
   */
  public async findById(id: string): Promise<User | null> {
    const rows = await this.database.query(
      `
        SELECT
            CAST(id AS VARCHAR) AS id,
            username,
            display_name
        FROM users
        WHERE id = CAST($id AS UUID);
      `,
      { id },
    );

    const row = rows[0];

    return row ? this.toUser(row) : null;
  }

  /**
   * Returns the credentials stored for a username.
   *
   * @param username - Username entered during login.
   * @returns The credentials, or `null` when no user exists.
   */
  public async findCredentialsByUsername(
    username: string,
  ): Promise<UserCredentials | null> {
    const rows = await this.database.query(
      `
        SELECT
            CAST(id AS VARCHAR) AS id,
            username,
            display_name,
            password_hash
        FROM users
        WHERE username = $username;
      `,
      { username },
    );

    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      user: this.toUser(row),
      passwordHash: readTextColumn(row, 3, "password_hash"),
    };
  }

  /**
   * Inserts a new user.
   *
   * @param user - User values including the password hash.
   */
  public async insert(user: NewUser): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO users (
            id,
            username,
            display_name,
            password_hash,
            role,
            updated_at
        )
        VALUES (
            CAST($id AS UUID),
            $username,
            $display_name,
            $password_hash,
            $role,
            CURRENT_TIMESTAMP
        );
      `,
      {
        id: user.id,
        username: user.username,
        display_name: user.displayName,
        password_hash: user.passwordHash,
        role: user.role,
      },
    );
  }

  private toUser(row: readonly DuckDBValue[]): User {
    return {
      id: readTextColumn(row, 0, "id"),
      username: readTextColumn(row, 1, "username"),
      displayName: readTextColumn(row, 2, "display_name"),
    };
  }
}
