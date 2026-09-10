import {
  readBooleanColumn,
  readCountColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { isRole } from "@/definition/Role";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { Role } from "@/definition/Role";
import type { User } from "@/definition/User";

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
  /** Email address, when the account carries one. */
  readonly email?: string | null;
  /** Whether the account may sign in; defaults to active. */
  readonly isActive?: boolean;
  /** Creation timestamp; defaults to the database clock. */
  readonly createdAt?: string;
}

/** Thrown when a username is already taken by another user. */
export class UsernameTakenError extends Error {
  public constructor(username: string) {
    super(`The username "${username}" is already taken.`);
  }
}

/** Owns persistence operations for users. */
export class UserRepository {
  private readonly database: Database;

  /**
   * Creates a user repository.
   *
   * @param database - Central database access.
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
            id,
            username,
            display_name,
            role,
            is_active
        FROM users
        WHERE id = $id;
      `,
      { id },
    );

    const row = rows[0];

    return row ? this.toUser(row) : null;
  }

  /**
   * Returns every user ordered by display name.
   *
   * @remarks
   * Intended for the user-management screen, which every caller must
   * authorize before this method is used.
   */
  public async findAll(): Promise<User[]> {
    const rows = await this.database.query(`
      SELECT
          id,
          username,
          display_name,
          role,
          is_active
      FROM users
      ORDER BY display_name;
    `);

    return rows.map((row) => this.toUser(row));
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
            id,
            username,
            display_name,
            role,
            is_active,
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
      passwordHash: readTextColumn(row, 5, "password_hash"),
    };
  }

  /**
   * Inserts a new user.
   *
   * @param user - User values including the password hash.
   * @throws {UsernameTakenError} When the username is already in use.
   */
  public async insert(user: NewUser): Promise<void> {
    try {
      await this.database.execute(
        `
          INSERT INTO users (
              id,
              username,
              display_name,
              password_hash,
              email,
              role,
              is_active,
              created_at,
              updated_at
          )
          VALUES (
              $id,
              $username,
              $display_name,
              $password_hash,
              $email,
              $role,
              $is_active,
              COALESCE($created_at, CURRENT_TIMESTAMP),
              CURRENT_TIMESTAMP
          );
        `,
        {
          id: user.id,
          username: user.username,
          display_name: user.displayName,
          password_hash: user.passwordHash,
          email: user.email ?? null,
          role: user.role,
          is_active: user.isActive ?? true,
          created_at: user.createdAt ?? null,
        },
      );
    } catch (error: unknown) {
      if (this.isUsernameConstraintViolation(error)) {
        throw new UsernameTakenError(user.username);
      }

      throw error;
    }
  }

  /**
   * Activates or deactivates a user.
   *
   * @param id - User identifier.
   * @param isActive - Whether the user should be able to sign in.
   */
  public async setActive(id: string, isActive: boolean): Promise<void> {
    await this.database.execute(
      `
        UPDATE users
        SET
            is_active = $is_active,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id;
      `,
      { id, is_active: isActive },
    );
  }

  /**
   * Replaces the stored password hash for a user.
   *
   * @param id - User identifier.
   * @param passwordHash - Newly computed password hash.
   */
  public async updatePasswordHash(
    id: string,
    passwordHash: string,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE users
        SET
            password_hash = $password_hash,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id;
      `,
      { id, password_hash: passwordHash },
    );
  }

  /** Returns the number of administrators who can currently sign in. */
  public async countActiveAdministrators(): Promise<number> {
    const rows = await this.database.query(`
      SELECT
          COUNT(id) AS admin_count
      FROM users
      WHERE role = 'admin'
          AND is_active = 1;
    `);
    const row = rows[0];

    if (!row) {
      throw new Error("Database returned no administrator count.");
    }

    return readCountColumn(row, 0, "admin_count");
  }

  private isUsernameConstraintViolation(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.includes("UNIQUE constraint failed") &&
      error.message.includes("users.username")
    );
  }

  private toUser(row: readonly DatabaseValue[]): User {
    const role = readTextColumn(row, 3, "role");

    if (!isRole(role)) {
      throw new Error(`Database returned an unsupported role "${role}".`);
    }

    return {
      id: readTextColumn(row, 0, "id"),
      username: readTextColumn(row, 1, "username"),
      displayName: readTextColumn(row, 2, "display_name"),
      role,
      isActive: readBooleanColumn(row, 4, "is_active"),
    };
  }
}
