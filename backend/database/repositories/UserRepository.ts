import { isUniqueViolationOn } from "@/backend/database/Database";
import {
  readBlobColumn,
  readBooleanColumn,
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { isRole } from "@/definition/Role";
import { isUserAvatarType } from "@/definition/User";
import { provisionAccount } from "./LegacyAccountProvisioning";
import {
  EmailTakenError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { Role } from "@/definition/Role";
import type { User, UserAvatarType } from "@/definition/User";
import type { AccountInitialization } from "@/definition/Authorization";

/** A user's binary avatar as stored in the database. */
export interface StoredUserAvatar {
  readonly mimeType: string;
  readonly filename: string;
  readonly data: Buffer;
}

/** A user together with the credentials required for authentication. */
export interface UserCredentials {
  readonly user: User;
  readonly passwordHash: string;
}

/** Values required to persist a new user. */
export interface NewUser {
  /** Explicit A2 authorization; absent only for legacy callers and fixtures. */
  readonly authorization?: AccountInitialization;
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly role: Role;
  /** Email address, when the account carries one. */
  readonly email?: string | null;
  /** Whether the account may sign in; defaults to active. */
  readonly isActive?: boolean;
  /** Whether the first authenticated request must replace the password. */
  readonly mustChangePassword?: boolean;
  /** Creation timestamp; defaults to the database clock. */
  readonly createdAt?: string;
}

/** Owns persistence operations for users. */
export class UserRepository {
  private readonly database: Pick<
    Database,
    "query" | "execute" | "transaction"
  >;

  /**
   * Creates a user repository.
   *
   * @param database - Central database access.
   */
  public constructor(
    database: Pick<Database, "query" | "execute" | "transaction">,
  ) {
    this.database = database;
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
            is_active,
            avatar_type,
            avatar_icon,
            avatar_color,
            avatar_image_url,
            must_change_password
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
          is_active,
          avatar_type,
          avatar_icon,
          avatar_color,
          avatar_image_url,
          must_change_password
      FROM users
      ORDER BY display_name;
    `);

    return rows.map((row) => this.toUser(row));
  }

  /**
   * Returns the user carrying the given email address.
   *
   * @param email - Email address to look up.
   * @returns The user, or `null` when no user uses the address.
   */
  public async findByEmail(email: string): Promise<User | null> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            username,
            display_name,
            role,
            is_active,
            avatar_type,
            avatar_icon,
            avatar_color,
            avatar_image_url,
            must_change_password
        FROM users
        WHERE email = $email;
      `,
      { email },
    );

    const row = rows[0];

    return row ? this.toUser(row) : null;
  }

  /**
   * Returns the stored email address for each requested user.
   *
   * @remarks
   * Kept as a separate lookup so the shared user mapping used by the
   * authentication paths stays untouched. Only the user-management screen
   * needs email addresses in bulk.
   *
   * @param ids - Identifiers of the users to look up.
   * @returns Email addresses keyed by user identifier, `null` when unset.
   */
  public async findEmailsByUserIds(
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, string | null>> {
    if (ids.length === 0) {
      return new Map();
    }

    const placeholders = ids.map((_, index) => `$id_${index}`).join(", ");
    const parameters: { [key: string]: string } = {};

    ids.forEach((id, index) => {
      parameters[`id_${index}`] = id;
    });

    const rows = await this.database.query(
      `
        SELECT
            id,
            email
        FROM users
        WHERE id IN (${placeholders});
      `,
      parameters,
    );

    const emails = new Map<string, string | null>();

    for (const row of rows) {
      emails.set(
        readTextColumn(row, 0, "id"),
        readNullableTextColumn(row, 1, "email"),
      );
    }

    return emails;
  }

  /**
   * Returns the credentials stored for a username.
   *
   * @param username - Username entered during login.
   * @returns The credentials, or `null` when no user exists.
   *
   * @remarks
   * Usernames are compared without regard to case.
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
            avatar_type,
            avatar_icon,
            avatar_color,
            avatar_image_url,
            must_change_password,
            password_hash
        FROM users
        WHERE lower(username) = lower($username);
      `,
      { username },
    );

    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      user: this.toUser(row),
      passwordHash: readTextColumn(row, 10, "password_hash"),
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
      await this.database.transaction(async (transaction) => {
        await transaction.execute(
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
              $must_change_password,
              COALESCE($created_at, utc_now()),
              utc_now()
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
            must_change_password: user.mustChangePassword ?? false,
            created_at: user.createdAt ?? null,
          },
        );
        await provisionAccount(transaction, user);
      });
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
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
        UPDATE users
        SET
            is_active = $is_active,
            updated_at = utc_now()
        WHERE id = $id;
      `,
        { id, is_active: isActive },
      );
      if (!isActive) {
        await transaction.execute("DELETE FROM sessions WHERE user_id = $id;", {
          id,
        });
        // A deactivated person cannot work on tickets; a group left without
        // members stays but cannot be assigned until someone joins it.
        await transaction.execute(
          "DELETE FROM user_group_members WHERE user_id = $id;",
          { id },
        );
      }
    });
  }

  /**
   * Replaces the basic profile values of a user.
   *
   * @param id - User identifier.
   * @param profile - New display name, username, email, and optional avatar info.
   * @throws {UsernameTakenError} When the username is already in use.
   * @throws {EmailTakenError} When the email address is already in use.
   */
  public async updateProfile(
    id: string,
    profile: {
      readonly displayName: string;
      readonly username: string;
      readonly email: string | null;
      readonly avatarType?: UserAvatarType;
      readonly avatarImageUrl?: string | null;
    },
  ): Promise<void> {
    try {
      await this.database.execute(
        `
          UPDATE users
          SET
              display_name = $display_name,
              username = $username,
              email = $email,
              avatar_type = COALESCE($avatar_type, avatar_type),
              avatar_image_url = COALESCE($avatar_image_url, avatar_image_url),
              updated_at = utc_now()
          WHERE id = $id;
        `,
        {
          id,
          display_name: profile.displayName,
          username: profile.username,
          email: profile.email,
          avatar_type: profile.avatarType ?? null,
          avatar_image_url: profile.avatarImageUrl ?? null,
        },
      );
    } catch (error: unknown) {
      if (this.isUsernameConstraintViolation(error)) {
        throw new UsernameTakenError(profile.username);
      }

      if (profile.email !== null && this.isEmailConstraintViolation(error)) {
        throw new EmailTakenError(profile.email);
      }

      throw error;
    }
  }

  /**
   * Replaces the avatar reference columns of a user.
   *
   * @param id - User identifier.
   * @param avatar - New avatar presentation type and image URL.
   */
  public async updateAvatarReference(
    id: string,
    avatar: {
      readonly avatarType: UserAvatarType;
      readonly avatarImageUrl: string | null;
    },
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE users
        SET
            avatar_type = $avatar_type,
            avatar_image_url = $avatar_image_url,
            updated_at = utc_now()
        WHERE id = $id;
      `,
      {
        id,
        avatar_type: avatar.avatarType,
        avatar_image_url: avatar.avatarImageUrl,
      },
    );
  }

  /**
   * Returns the stored custom avatar image of a user.
   *
   * @param userId - User identifier.
   * @returns The stored avatar record, or `null` when none exists.
   */
  public async findAvatarByUserId(
    userId: string,
  ): Promise<StoredUserAvatar | null> {
    const rows = await this.database.query(
      `
        SELECT
            mime_type,
            filename,
            data
        FROM user_avatars
        WHERE user_id = $user_id;
      `,
      { user_id: userId },
    );

    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      mimeType: readTextColumn(row, 0, "mime_type"),
      filename: readTextColumn(row, 1, "filename"),
      data: readBlobColumn(row, 2, "data"),
    };
  }

  /**
   * Creates or replaces the custom avatar image of a user.
   *
   * @param userId - User identifier.
   * @param avatar - New avatar image values.
   */
  public async upsertAvatar(
    userId: string,
    avatar: StoredUserAvatar,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO user_avatars (
            user_id,
            mime_type,
            filename,
            data,
            updated_at
        )
        VALUES (
            $user_id,
            $mime_type,
            $filename,
            $data,
            utc_now()
        )
        ON CONFLICT (user_id) DO UPDATE SET
            mime_type = excluded.mime_type,
            filename = excluded.filename,
            data = excluded.data,
            updated_at = utc_now();
      `,
      {
        user_id: userId,
        mime_type: avatar.mimeType,
        filename: avatar.filename,
        data: avatar.data,
      },
    );
  }

  /**
   * Replaces the role of a user.
   *
   * @param id - User identifier.
   * @param role - New role to assign.
   */
  public async updateRole(id: string, role: Role): Promise<void> {
    await this.database.execute(
      `
        UPDATE users
        SET
            role = $role,
            updated_at = utc_now()
        WHERE id = $id;
      `,
      { id, role },
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
            must_change_password = 0,
            updated_at = utc_now()
        WHERE id = $id;
      `,
      { id, password_hash: passwordHash },
    );
  }

  /** Stores a temporary password and invalidates all sessions in one transaction. */
  public async resetPasswordHash(
    id: string,
    passwordHash: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
        UPDATE users
        SET
            password_hash = $password_hash,
            must_change_password = 1,
            updated_at = utc_now()
        WHERE id = $id;
      `,
        { id, password_hash: passwordHash },
      );
      await transaction.execute("DELETE FROM sessions WHERE user_id = $id;", {
        id,
      });
    });
  }

  /** Returns the number of administrators who can currently sign in. */
  public async countActiveAdministrators(): Promise<number> {
    const rows = await this.database.query(`
      SELECT
          COUNT(users.id) AS admin_count
      FROM users
      INNER JOIN user_authorization AS access ON access.user_id = users.id
      WHERE access.is_admin = 1
          AND users.is_active = 1;
    `);
    const row = rows[0];

    if (!row) {
      throw new Error("Database returned no administrator count.");
    }

    return readCountColumn(row, 0, "admin_count");
  }

  private isUsernameConstraintViolation(error: unknown): boolean {
    // The plain constraint names the column, the case-insensitive index the
    // expression it covers.
    return (
      isUniqueViolationOn(error, "username") ||
      isUniqueViolationOn(error, "lower(username)")
    );
  }

  private isEmailConstraintViolation(error: unknown): boolean {
    return isUniqueViolationOn(error, "email");
  }

  private toUser(row: readonly DatabaseValue[]): User {
    const role = readTextColumn(row, 3, "role");
    const avatarType = readTextColumn(row, 5, "avatar_type");

    if (!isRole(role)) {
      throw new Error(`Database returned an unsupported role "${role}".`);
    }

    if (!isUserAvatarType(avatarType)) {
      throw new Error(
        `Database returned an unsupported avatar type "${avatarType}".`,
      );
    }

    return {
      id: readTextColumn(row, 0, "id"),
      username: readTextColumn(row, 1, "username"),
      displayName: readTextColumn(row, 2, "display_name"),
      role,
      isActive: readBooleanColumn(row, 4, "is_active"),
      mustChangePassword: readBooleanColumn(row, 9, "must_change_password"),
      avatarType,
      avatarIcon: readNullableTextColumn(row, 6, "avatar_icon"),
      avatarColor: readNullableTextColumn(row, 7, "avatar_color"),
      avatarImageUrl: readNullableTextColumn(row, 8, "avatar_image_url"),
    };
  }
}
