import { PERMISSION, ROLE } from "@/definition/Role";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type {
  NewUser,
  UserCredentials,
  UserRepository,
} from "@/backend/database/repositories/UserRepository";
import type { User } from "@/definition/User";

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
}
