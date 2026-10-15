import { PermissionService } from "@/backend/auth/PermissionService";
import { SessionService } from "@/backend/auth/SessionService";
import { UserService } from "@/backend/service/UserService";

import { AuthorizationWorld } from "../service/accounts/authorization-world";
import { MemoryUserRepository } from "../service/accounts/memory-user-repository";
import { MemorySessionRepository } from "./session-repository-memory";

import type { PersonOptions } from "../service/accounts/authorization-world";
import type { AccountOptions } from "./account-fixture";

/**
 * Real session and user services over in-memory persistence.
 *
 * @remarks
 * Neither a database nor a clock of the machine is involved; tests move the
 * clock with fake timers.
 */
export class SessionWorld {
  public readonly accounts = new AuthorizationWorld();
  public readonly users: UserService;
  public readonly repository: MemorySessionRepository;
  public readonly sessions: SessionService;

  /** Builds the services over an empty directory. */
  public constructor() {
    this.users = new UserService(
      new MemoryUserRepository(this.accounts.store),
      new PermissionService(),
    );
    this.repository = new MemorySessionRepository(
      (userId) => this.accounts.store.users.get(userId)?.user.isActive === true,
    );
    this.sessions = new SessionService(this.repository, this.users);
  }

  /** Adds a person who can sign in unless the options say otherwise. */
  public addPerson(options: AccountOptions & PersonOptions = {}): void {
    this.accounts.addAccount(options);
  }
}
