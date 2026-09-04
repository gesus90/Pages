import { randomUUID } from "node:crypto";

import { ROLE } from "@/definition/Role";

import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";

const DEFAULT_ADMINISTRATOR_USERNAME = "admin";
const DEFAULT_ADMINISTRATOR_DISPLAY_NAME = "Admin";
const DEFAULT_ADMINISTRATOR_PASSWORD = "admin";

/** Provides setup-state business logic. */
export class SetupService {
  private readonly userRepository: UserRepository;
  private readonly passwordHasher: PasswordHasher;

  /**
   * Creates a setup service.
   *
   * @param userRepository - User persistence boundary.
   * @param passwordHasher - Argon2id password hashing.
   */
  public constructor(
    userRepository: UserRepository,
    passwordHasher: PasswordHasher,
  ) {
    this.userRepository = userRepository;
    this.passwordHasher = passwordHasher;
  }

  /** Returns whether Pages still needs its first user. */
  public async isSetupRequired(): Promise<boolean> {
    return !(await this.userRepository.hasUsers());
  }

  /**
   * Creates the default administrator on a fresh installation.
   *
   * @returns Whether the administrator was created by this call.
   *
   * @remarks
   * An existing administrator is never modified, so a password changed later
   * is never reset back to the initial one.
   */
  public async ensureDefaultAdministrator(): Promise<boolean> {
    if (!(await this.isSetupRequired())) {
      return false;
    }

    const passwordHash = await this.passwordHasher.hash(
      DEFAULT_ADMINISTRATOR_PASSWORD,
    );

    await this.userRepository.insert({
      id: randomUUID(),
      username: DEFAULT_ADMINISTRATOR_USERNAME,
      displayName: DEFAULT_ADMINISTRATOR_DISPLAY_NAME,
      passwordHash,
      role: ROLE.ADMIN,
    });

    return true;
  }
}
