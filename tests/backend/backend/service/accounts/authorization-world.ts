import { vi } from "vitest";

import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AdministrationService } from "@/backend/service/AdministrationService";

import {
  accountFixture,
  administratorFixture,
  roleFixture,
} from "../../auth/account-fixture";
import { MemoryAuthorizationRepository } from "./memory-authorization-repository";
import { MemoryAuthorizationStore } from "./memory-authorization-store";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type {
  AccountAccess,
  Department,
  UserRole,
} from "@/definition/Authorization";
import type { Role } from "@/definition/Role";
import type { User } from "@/definition/User";
import type { UserGroup } from "@/definition/UserGroup";
import type { AccountOptions } from "../../auth/account-fixture";

/** Name a person is stored with in the memory directory. */
export interface PersonOptions {
  readonly username?: string;
  readonly email?: string | null;
  /** Password the stub hasher accepts for the person. */
  readonly password?: string;
  /** Role of the compatibility API, which exists beside the configurable roles. */
  readonly legacyRole?: Role;
  /** Whether the person must replace the password before anything else. */
  readonly mustChangePassword?: boolean;
}

/** Password of every synthetic person unless a test names another. */
export const DEFAULT_PASSWORD = "synthetic-password";

/** The cache invalidations a test can observe on the shared cache. */
const OBSERVED_INVALIDATIONS = [
  "invalidateUsers",
  "invalidateProjectMembership",
  "invalidateWorkItems",
  "invalidateProjectsList",
  "invalidateLabels",
  "invalidateGitHub",
] as const;

/** Hashes deterministically and instantly instead of running scrypt. */
export function stubPasswordHasher(): PasswordHasher {
  const hasher = new PasswordHasher();

  vi.spyOn(hasher, "hash").mockImplementation(
    async (password) => `hashed:${password}`,
  );
  vi.spyOn(hasher, "verify").mockImplementation(
    async (passwordHash, password) => passwordHash === `hashed:${password}`,
  );

  return hasher;
}

/**
 * The authorization aggregate with its collaborators, held in memory.
 *
 * @remarks
 * Nothing here touches a database; the repository fakes read and write the
 * store, and the cache is a disabled one whose invalidations are recorded.
 */
export class AuthorizationWorld {
  public readonly store = new MemoryAuthorizationStore();
  public readonly repository = new MemoryAuthorizationRepository(this.store);
  public readonly cache = ServerCache.disabled();
  public readonly hasher = stubPasswordHasher();
  public readonly invalidations: string[] = [];

  public constructor() {
    for (const method of OBSERVED_INVALIDATIONS) {
      vi.spyOn(this.cache, method).mockImplementation(() => {
        this.invalidations.push(method);
      });
    }
    vi.spyOn(this.cache, "invalidatePrefix").mockImplementation(
      (...prefixes: string[]) => {
        this.invalidations.push(`invalidatePrefix:${prefixes.join(",")}`);
      },
    );
  }

  /** Builds the production administration service for a channel. */
  public service(channel: ActorChannel = "ui"): AdministrationService {
    return new AdministrationService(
      this.repository,
      this.cache,
      this.hasher,
      channel,
    );
  }

  /** Stores a role the accounts and the actor can refer to. */
  public addRole(options: Parameters<typeof roleFixture>[0] = {}): UserRole {
    const role = roleFixture(options);

    this.store.roles = [...this.store.roles, role];

    return role;
  }

  /** Stores a department. */
  public addDepartment(id: string, name = id): Department {
    const department = { id, name };

    this.store.departments = [...this.store.departments, department];

    return department;
  }

  /** Stores an account with its role and a matching user row. */
  public addAccount(
    options: AccountOptions & PersonOptions = {},
  ): AccountAccess {
    const account = accountFixture(options);

    return this.insertPerson(account, options);
  }

  /** Stores an administrator in administrator mode. */
  public addAdministrator(
    options: AccountOptions & PersonOptions = {},
  ): AccountAccess {
    return this.insertPerson(administratorFixture(options), options);
  }

  /** Stores a group with its members. */
  public addGroup(group: UserGroup): void {
    this.store.groups = [...this.store.groups, group];
  }

  /** Reads the persisted account of a person. */
  public account(userId: string): AccountAccess {
    const account = this.store
      .readAccounts()
      .find((candidate) => candidate.userId === userId);

    if (!account) {
      throw new Error(`Unknown synthetic account ${userId}`);
    }

    return account;
  }

  /** Reads the persisted user row of a person. */
  public user(userId: string): User {
    const record = this.store.users.get(userId);

    if (!record) {
      throw new Error(`Unknown synthetic user ${userId}`);
    }

    return record.user;
  }

  /** Finds a person created through the service by its username. */
  public findByUsername(username: string): User | null {
    return (
      [...this.store.users.values()].find(
        (record) => record.user.username === username,
      )?.user ?? null
    );
  }

  /** Changes the sign-in state of a stored person, as an earlier operation would have. */
  public setUserActive(userId: string, isActive: boolean): void {
    const record = this.store.users.get(userId);

    if (!record) {
      throw new Error(`Unknown synthetic user ${userId}`);
    }

    this.store.users.set(userId, {
      ...record,
      user: { ...record.user, isActive },
    });
  }

  /** Writes recorded since the world was built, in call order. */
  public get writes(): readonly string[] {
    return this.store.writes;
  }

  private insertPerson(
    account: AccountAccess,
    options: PersonOptions,
  ): AccountAccess {
    const role = account.role;

    if (role && !this.store.roles.some((entry) => entry.id === role.id)) {
      this.store.roles = [...this.store.roles, role];
    }

    this.store.accounts.set(account.userId, account);
    this.store.users.set(account.userId, {
      user: {
        id: account.userId,
        username: options.username ?? account.userId,
        displayName: `${account.firstName} ${account.lastName}`,
        role: options.legacyRole ?? "employee",
        isActive: account.isActive,
        mustChangePassword: options.mustChangePassword ?? false,
      },
      email: options.email ?? null,
      passwordHash: `hashed:${options.password ?? DEFAULT_PASSWORD}`,
    });

    return account;
  }
}
