import { ROLE } from "@/definition/Role";

import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";

const DEFAULT_ADMINISTRATOR_USERNAME = "admin";
const DEFAULT_ADMINISTRATOR_DISPLAY_NAME = "Admin";
const DEFAULT_ADMINISTRATOR_PASSWORD = "admin";

/**
 * Keeps the administrator that early Pages versions created automatically
 * able to sign in.
 */
export class SetupService {
  private readonly userRepository: UserRepository;
  private readonly passwordHasher: PasswordHasher;

  /**
   * Creates a setup service.
   *
   * @param userRepository - User persistence boundary.
   * @param passwordHasher - scrypt password hashing.
   */
  public constructor(
    userRepository: UserRepository,
    passwordHasher: PasswordHasher,
  ) {
    this.userRepository = userRepository;
    this.passwordHasher = passwordHasher;
  }

  /**
   * Rehashes the seeded administrator's password when it still carries a
   * hash from a previously used, now-removed hashing library.
   *
   * @returns Whether the administrator's password hash was migrated.
   *
   * @remarks
   * Pages can no longer verify hashes produced by a removed hashing
   * dependency, which would otherwise lock that account out permanently.
   * Migration only runs when the username, display name, and role still
   * exactly match the untouched bootstrap administrator that early versions
   * seeded as `admin`/`admin`, the only case where the original
   * password is known here. No other account is ever touched, and an
   * administrator whose password has since changed keeps whatever hash
   * that change already produced.
   */
  public async migrateLegacyBootstrapAdministrator(): Promise<boolean> {
    const credentials = await this.userRepository.findCredentialsByUsername(
      DEFAULT_ADMINISTRATOR_USERNAME,
    );

    if (!credentials) {
      return false;
    }

    const { user, passwordHash } = credentials;
    const isUntouchedBootstrapAdministrator =
      user.displayName === DEFAULT_ADMINISTRATOR_DISPLAY_NAME &&
      user.role === ROLE.ADMIN;

    if (
      !isUntouchedBootstrapAdministrator ||
      this.passwordHasher.isSupportedHash(passwordHash)
    ) {
      return false;
    }

    await this.userRepository.updatePasswordHash(
      user.id,
      await this.passwordHasher.hash(DEFAULT_ADMINISTRATOR_PASSWORD),
    );

    return true;
  }
}
