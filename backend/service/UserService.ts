import { randomBytes } from "node:crypto";

import {
  EmailTakenError,
  UsernameTakenError,
} from "@/backend/database/repositories/UserRepository";
import { PERMISSION, ROLE } from "@/definition/Role";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type {
  NewUser,
  StoredUserAvatar,
  UserCredentials,
  UserRepository,
} from "@/backend/database/repositories/UserRepository";
import type { Role } from "@/definition/Role";
import type { User, UserAvatarType } from "@/definition/User";

/** Thrown when an actor lacks the permission to manage users at all. */
export class UserManagementDeniedError extends Error {
  public constructor() {
    super("This user is not allowed to manage users.");
  }
}

/** Thrown when an actor tries to assign or keep a role beyond their reach. */
export class RoleAssignmentDeniedError extends Error {
  public constructor() {
    super("This user is not allowed to assign the requested role.");
  }
}

/** Thrown when a referenced user does not exist. */
export class UserNotFoundError extends Error {
  public constructor() {
    super("The requested user does not exist.");
  }
}

/** Thrown when an action would leave Pages without an active administrator. */
export class LastAdministratorError extends Error {
  public constructor() {
    super("The last active administrator cannot be deactivated.");
  }
}

/** Characters used for generated passwords, without ambiguous glyphs. */
const TEMPORARY_PASSWORD_ALPHABET =
  "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

const TEMPORARY_PASSWORD_LENGTH = 12;

/**
 * Generates a readable temporary password grouped for easy transcription.
 *
 * @returns A password such as `k7Rq-9mZ2-x4Tp`.
 */
function generateTemporaryPassword(): string {
  const bytes = randomBytes(TEMPORARY_PASSWORD_LENGTH);
  const characters = Array.from(
    bytes,
    (byte) =>
      TEMPORARY_PASSWORD_ALPHABET[byte % TEMPORARY_PASSWORD_ALPHABET.length],
  );

  return [
    characters.slice(0, 4).join(""),
    characters.slice(4, 8).join(""),
    characters.slice(8, 12).join(""),
  ].join("-");
}

/** Establishes the business-logic boundary for users. */
export class UserService {
  private readonly userRepository: UserRepository;
  private readonly permissionService: PermissionService;

  /**
   * Creates a user service.
   *
   * @param userRepository - User persistence boundary.
   * @param permissionService - Role and permission authorization boundary.
   */
  public constructor(
    userRepository: UserRepository,
    permissionService: PermissionService,
  ) {
    this.userRepository = userRepository;
    this.permissionService = permissionService;
  }

  /**
   * Returns the user with the given identifier.
   *
   * @param id - User identifier.
   * @returns The user, or `null` when no user exists.
   */
  public async getById(id: string): Promise<User | null> {
    return this.userRepository.findById(id);
  }

  /**
   * Returns every user, ordered by display name.
   *
   * @param actor - User requesting the list.
   * @throws {UserManagementDeniedError} When the actor may not view users.
   */
  public async findAll(actor: User): Promise<User[]> {
    if (
      !this.permissionService.hasPermission(actor.role, PERMISSION.VIEW_USERS)
    ) {
      throw new UserManagementDeniedError();
    }

    return this.userRepository.findAll();
  }

  /**
   * Returns the stored email addresses for the given users.
   *
   * @param actor - User requesting the addresses.
   * @param userIds - Identifiers of the users to look up.
   * @returns Email addresses keyed by user identifier, `null` when unset.
   * @throws {UserManagementDeniedError} When the actor may not view users.
   */
  public async findEmailAddresses(
    actor: User,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, string | null>> {
    if (
      !this.permissionService.hasPermission(actor.role, PERMISSION.VIEW_USERS)
    ) {
      throw new UserManagementDeniedError();
    }

    return this.userRepository.findEmailsByUserIds(userIds);
  }

  /**
   * Returns the stored email address of a single user.
   *
   * @param userId - Identifier of the user to look up.
   * @returns The email address, or `null` when unset.
   *
   * @remarks
   * Intended for a user reading their own profile, so no permission check is
   * applied; callers must not use it to look up other users' addresses.
   */
  public async findProfileEmail(userId: string): Promise<string | null> {
    const emails = await this.userRepository.findEmailsByUserIds([userId]);

    return emails.get(userId) ?? null;
  }

  /**
   * Updates the professional profile values of the authenticated user.
   *
   * @param actor - Authenticated user updating their own profile.
   * @param profile - New display name, username, email, and role.
   * @throws {UserManagementDeniedError} When the actor is not an administrator.
   * @throws {UserNotFoundError} When the actor no longer exists.
   * @throws {UsernameTakenError} When the username is already in use.
   * @throws {EmailTakenError} When the email address is already in use.
   * @throws {RoleAssignmentDeniedError} When the actor may not assign the
   * requested role.
   * @throws {LastAdministratorError} When the change would leave no active
   * administrator.
   *
   * @remarks
   * Text and role changes are an administrative operation, even when an
   * administrator edits their own profile. Ordinary users keep a read-only
   * profile and may only change their avatar via {@link updateOwnAvatar}.
   */
  public async updateOwnProfile(
    actor: User,
    profile: {
      readonly displayName: string;
      readonly username: string;
      readonly email: string | null;
      readonly role: Role;
    },
  ): Promise<void> {
    if (actor.role !== ROLE.ADMIN) {
      throw new UserManagementDeniedError();
    }

    const user = await this.userRepository.findById(actor.id);

    if (!user) {
      throw new UserNotFoundError();
    }

    if (profile.username !== user.username) {
      const existingUser = await this.userRepository.findCredentialsByUsername(
        profile.username,
      );

      if (existingUser && existingUser.user.id !== actor.id) {
        throw new UsernameTakenError(profile.username);
      }
    }

    if (profile.email) {
      const owner = await this.userRepository.findByEmail(profile.email);

      if (owner && owner.id !== actor.id) {
        throw new EmailTakenError(profile.email);
      }
    }

    if (profile.role !== user.role) {
      if (!this.permissionService.canAssignRole(actor.role, profile.role)) {
        throw new RoleAssignmentDeniedError();
      }

      if (
        user.isActive &&
        user.role === ROLE.ADMIN &&
        profile.role !== ROLE.ADMIN
      ) {
        const activeAdministrators =
          await this.userRepository.countActiveAdministrators();

        if (activeAdministrators <= 1) {
          throw new LastAdministratorError();
        }
      }

      await this.userRepository.updateRole(actor.id, profile.role);
    }

    await this.userRepository.updateProfile(actor.id, profile);
  }

  /**
   * Replaces the custom avatar image of a user with their own picture.
   *
   * @param userId - Identifier of the user updating their own avatar.
   * @param avatar - Image binary, metadata, and avatar reference values.
   *
   * @remarks
   * Deliberately separate from {@link updateOwnProfile}: every authenticated
   * user may change their own avatar, while display name, username, email,
   * and role stay restricted to administrators.
   */
  public async updateOwnAvatar(
    userId: string,
    avatar: StoredUserAvatar & {
      readonly avatarType: UserAvatarType;
      readonly avatarImageUrl: string;
    },
  ): Promise<void> {
    await this.replaceAvatar(userId, avatar);
    await this.userRepository.updateAvatarReference(userId, {
      avatarImageUrl: avatar.avatarImageUrl,
      avatarType: avatar.avatarType,
    });
  }

  /**
   * Returns a user's stored custom avatar image.
   *
   * @param userId - Identifier of the user whose avatar is requested.
   */
  public async getAvatar(userId: string): Promise<StoredUserAvatar | null> {
    return this.userRepository.findAvatarByUserId(userId);
  }

  /**
   * Persistently replaces a user's custom avatar image.
   *
   * @param userId - Identifier of the user.
   * @param avatar - Image binary and metadata.
   */
  public async replaceAvatar(
    userId: string,
    avatar: StoredUserAvatar,
  ): Promise<void> {
    await this.userRepository.upsertAvatar(userId, avatar);
  }

  /**
   * Replaces the stored password hash of a user.
   *
   * @param userId - Identifier of the user being changed.
   * @param passwordHash - Newly computed password hash.
   *
   * @remarks
   * Intended for password changes the caller initiates on behalf of the
   * authenticated user themselves, so no permission check is applied; the
   * caller must have verified the current password before invoking this.
   */
  public async updatePasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.userRepository.updatePasswordHash(userId, passwordHash);
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
    return this.userRepository.findCredentialsByUsername(username);
  }

  /**
   * Creates a user on behalf of an authorized actor.
   *
   * @param actor - User performing the creation.
   * @param user - User values including the password hash.
   * @throws {UserManagementDeniedError} When the actor may not manage users.
   * @throws {RoleAssignmentDeniedError} When the actor may not assign the
   * requested role.
   * @throws {UsernameTakenError} When the username is already in use.
   */
  public async createUser(actor: User, user: NewUser): Promise<void> {
    if (
      !this.permissionService.hasPermission(actor.role, PERMISSION.MANAGE_USERS)
    ) {
      throw new UserManagementDeniedError();
    }

    if (!this.permissionService.canAssignRole(actor.role, user.role)) {
      throw new RoleAssignmentDeniedError();
    }

    if (user.email) {
      const owner = await this.userRepository.findByEmail(user.email);

      if (owner) {
        throw new EmailTakenError(user.email);
      }
    }

    await this.userRepository.insert(user);
  }

  /**
   * Activates or deactivates a user on behalf of an authorized actor.
   *
   * @param actor - User performing the change.
   * @param targetUserId - Identifier of the user being changed.
   * @param isActive - Whether the user should be able to sign in.
   * @throws {UserManagementDeniedError} When the actor may not manage the target user.
   * @throws {UserNotFoundError} When the target user does not exist.
   * @throws {LastAdministratorError} When deactivating the target would leave
   * no active administrator.
   */
  public async setActive(
    actor: User,
    targetUserId: string,
    isActive: boolean,
  ): Promise<void> {
    if (
      !this.permissionService.hasPermission(actor.role, PERMISSION.MANAGE_USERS)
    ) {
      throw new UserManagementDeniedError();
    }

    const target = await this.userRepository.findById(targetUserId);

    if (!target) {
      throw new UserNotFoundError();
    }

    if (!this.permissionService.canManageUser(actor.role, target.role)) {
      throw new UserManagementDeniedError();
    }

    if (!isActive && target.role === ROLE.ADMIN) {
      const activeAdministrators =
        await this.userRepository.countActiveAdministrators();

      if (activeAdministrators <= 1) {
        throw new LastAdministratorError();
      }
    }

    await this.userRepository.setActive(targetUserId, isActive);
  }

  /**
   * Replaces the basic profile values of a user.
   *
   * @param actor - User performing the change.
   * @param targetUserId - Identifier of the user being changed.
   * @param profile - New display name, username, and email.
   * @throws {UserManagementDeniedError} When the actor may not manage the target user.
   * @throws {UserNotFoundError} When the target user does not exist.
   * @throws {UsernameTakenError} When the username is already in use.
   * @throws {EmailTakenError} When the email address is already in use.
   */
  public async updateUser(
    actor: User,
    targetUserId: string,
    profile: {
      readonly displayName: string;
      readonly username: string;
      readonly email: string | null;
    },
  ): Promise<void> {
    if (
      !this.permissionService.hasPermission(actor.role, PERMISSION.MANAGE_USERS)
    ) {
      throw new UserManagementDeniedError();
    }

    const target = await this.userRepository.findById(targetUserId);

    if (!target) {
      throw new UserNotFoundError();
    }

    if (!this.permissionService.canManageUser(actor.role, target.role)) {
      throw new UserManagementDeniedError();
    }

    if (profile.email) {
      const owner = await this.userRepository.findByEmail(profile.email);

      if (owner && owner.id !== targetUserId) {
        throw new EmailTakenError(profile.email);
      }
    }

    await this.userRepository.updateProfile(targetUserId, profile);
  }

  /**
   * Replaces the role of a user.
   *
   * @param actor - User performing the change.
   * @param targetUserId - Identifier of the user being changed.
   * @param role - New role to assign.
   * @throws {UserManagementDeniedError} When the actor may not manage the target user.
   * @throws {RoleAssignmentDeniedError} When the actor may not assign the
   * requested role.
   * @throws {UserNotFoundError} When the target user does not exist.
   * @throws {LastAdministratorError} When demoting the target would leave
   * no active administrator.
   */
  public async setRole(
    actor: User,
    targetUserId: string,
    role: Role,
  ): Promise<void> {
    if (
      !this.permissionService.hasPermission(actor.role, PERMISSION.MANAGE_USERS)
    ) {
      throw new UserManagementDeniedError();
    }

    const target = await this.userRepository.findById(targetUserId);

    if (!target) {
      throw new UserNotFoundError();
    }

    if (!this.permissionService.canManageUser(actor.role, target.role)) {
      throw new UserManagementDeniedError();
    }

    if (!this.permissionService.canAssignRole(actor.role, role)) {
      throw new RoleAssignmentDeniedError();
    }

    if (target.isActive && target.role === ROLE.ADMIN && role !== ROLE.ADMIN) {
      const activeAdministrators =
        await this.userRepository.countActiveAdministrators();

      if (activeAdministrators <= 1) {
        throw new LastAdministratorError();
      }
    }

    await this.userRepository.updateRole(targetUserId, role);
  }

  /**
   * Replaces the password of a user with a generated temporary password.
   *
   * @remarks
   * The plain-text password is returned exactly once so the requesting
   * administrator can hand it over; only its hash is persisted.
   *
   * @param actor - User performing the reset.
   * @param targetUserId - Identifier of the user being changed.
   * @param passwordHasher - Hasher used for the new password.
   * @returns The temporary password in plain text.
   * @throws {UserManagementDeniedError} When the actor may not manage the target user.
   * @throws {UserNotFoundError} When the target user does not exist.
   */
  public async resetPassword(
    actor: User,
    targetUserId: string,
    passwordHasher: PasswordHasher,
  ): Promise<{ readonly temporaryPassword: string }> {
    if (
      !this.permissionService.hasPermission(actor.role, PERMISSION.MANAGE_USERS)
    ) {
      throw new UserManagementDeniedError();
    }

    const target = await this.userRepository.findById(targetUserId);

    if (!target) {
      throw new UserNotFoundError();
    }

    if (!this.permissionService.canManageUser(actor.role, target.role)) {
      throw new UserManagementDeniedError();
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await passwordHasher.hash(temporaryPassword);

    await this.userRepository.updatePasswordHash(targetUserId, passwordHash);

    return { temporaryPassword };
  }
}
