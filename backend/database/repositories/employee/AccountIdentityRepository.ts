import { isUniqueViolationOn } from "@/backend/database/Database";
import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { UsernameTakenError } from "@/backend/error/UserErrors";

import type { Database } from "@/backend/database/Database";

/**
 * The value an agent account stores instead of a password hash.
 *
 * @remarks
 * No hash function produces it, so no password ever matches; sign-in refuses
 * agent accounts before it compares anything anyway.
 */
const NO_PASSWORD = "!agent-account-without-password";

// The plain constraint names the column, the case-insensitive index the expression.
function isUsernameTaken(error: unknown): boolean {
  return (
    isUniqueViolationOn(error, "username") ||
    isUniqueViolationOn(error, "lower(username)")
  );
}

/** The identity fields of an agent account. */
export interface AgentAccountIdentity {
  readonly username: string;
  readonly displayName: string;
  readonly jobTitle: string | null;
  readonly avatarColor: string | null;
}

/**
 * The parts of `users` that PAGE-266 adds: the account kind, the job title
 * and the person color.
 *
 * @remarks
 * Agent accounts are inserted here, never by the person administration, so
 * they always carry the agent kind and no password.
 */
export class AccountIdentityRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /**
   * Inserts an agent account.
   *
   * @throws {UsernameTakenError} When the username is already in use.
   */
  public async insertAgent(
    id: string,
    identity: AgentAccountIdentity,
  ): Promise<void> {
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
              must_change_password,
              account_kind,
              job_title,
              avatar_color
          )
          VALUES (
              $id,
              $username,
              $display_name,
              $password_hash,
              NULL,
              'employee',
              1,
              0,
              'agent',
              $job_title,
              $avatar_color
          );
        `,
        {
          id,
          username: identity.username,
          display_name: identity.displayName,
          password_hash: NO_PASSWORD,
          job_title: identity.jobTitle,
          avatar_color: identity.avatarColor,
        },
      );
    } catch (error: unknown) {
      if (isUsernameTaken(error))
        throw new UsernameTakenError(identity.username);
      throw error;
    }
  }

  /**
   * Replaces the identity fields of an agent account; a person is never changed.
   *
   * @throws {UsernameTakenError} When the username is already in use.
   */
  public async updateAgent(
    id: string,
    identity: AgentAccountIdentity,
  ): Promise<void> {
    try {
      await this.database.execute(
        `
          UPDATE users
          SET
              username = $username,
              display_name = $display_name,
              job_title = $job_title,
              avatar_color = $avatar_color,
              updated_at = utc_now()
          WHERE id = $id
              AND account_kind = 'agent';
        `,
        {
          id,
          username: identity.username,
          display_name: identity.displayName,
          job_title: identity.jobTitle,
          avatar_color: identity.avatarColor,
        },
      );
    } catch (error: unknown) {
      if (isUsernameTaken(error))
        throw new UsernameTakenError(identity.username);
      throw error;
    }
  }

  /** Sets the person color of any account; `null` returns to the former look. */
  public async setColor(id: string, color: string | null): Promise<void> {
    await this.database.execute(
      `
        UPDATE users
        SET
            avatar_color = $avatar_color,
            updated_at = utc_now()
        WHERE id = $id;
      `,
      { id, avatar_color: color },
    );
  }

  /** Returns the job titles of the agent accounts by user ID. */
  public async jobTitles(): Promise<Map<string, string | null>> {
    const rows = await this.database.query(`
      SELECT
          id,
          job_title
      FROM users
      WHERE account_kind = 'agent';
    `);
    return new Map(
      rows.map((row) => [
        readTextColumn(row, 0, "id"),
        readNullableTextColumn(row, 1, "job_title"),
      ]),
    );
  }
}
