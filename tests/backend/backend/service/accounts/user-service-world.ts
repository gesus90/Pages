import { PermissionService } from "@/backend/auth/PermissionService";
import { UserService } from "@/backend/service/UserService";

import { AuthorizationWorld } from "./authorization-world";
import { MemoryUserRepository } from "./memory-user-repository";

import type { PasswordHasher } from "@/backend/auth/PasswordHasher";

/** Plain-text password the stub hasher of the user service tests accepts. */
export const KNOWN_PASSWORD = "known password";

/**
 * The user service over in-memory persistence.
 *
 * @remarks
 * Without the administration service the service runs the compatibility
 * policy of the three fixed roles; with it, every call is delegated.
 */
export class UserServiceWorld {
  public readonly accounts = new AuthorizationWorld();
  public readonly repository = new MemoryUserRepository(this.accounts.store);
  public readonly permissions = new PermissionService();

  /** Builds the compatibility service. */
  public legacyService(): UserService {
    return new UserService(this.repository, this.permissions);
  }

  /** Builds the service that delegates to the administration service. */
  public delegatingService(): UserService {
    return new UserService(
      this.repository,
      this.permissions,
      this.accounts.service(),
    );
  }

  /** A hasher that is not the one of the administration service. */
  public foreignHasher(): PasswordHasher {
    return this.accounts.hasher;
  }
}
