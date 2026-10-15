import type {
  AccountAccess,
  Department,
  UserRole,
} from "@/definition/Authorization";
import type { AgentReference } from "@/definition/AgentUsage";
import type { User } from "@/definition/User";
import type { UserGroup } from "@/definition/UserGroup";

/** A user row together with the values that never leave the persistence layer. */
export interface MemoryUserRecord {
  readonly user: User;
  readonly email: string | null;
  readonly passwordHash: string;
}

/** The state a rolled back transaction restores. */
export interface MemoryStoreCheckpoint {
  readonly roles: readonly UserRole[];
  readonly departments: readonly Department[];
  readonly accounts: ReadonlyMap<string, AccountAccess>;
  readonly users: ReadonlyMap<string, MemoryUserRecord>;
  readonly groups: readonly UserGroup[];
}

/**
 * In-memory persistence state of the authorization aggregate.
 *
 * @remarks
 * Stores plain values only; the repository fakes read and write it, so no
 * database is opened by the tests that use it.
 */
export class MemoryAuthorizationStore {
  public roles: UserRole[] = [];
  public departments: Department[] = [];
  public accounts = new Map<string, AccountAccess>();
  public users = new Map<string, MemoryUserRecord>();
  public groups: UserGroup[] = [];
  /** Agents (by name) that reference a group or department, keyed `kind:id`. */
  public readonly agentProfileReferences = new Map<string, AgentReference[]>();
  /** Connections (by name) that list a group or department, keyed `kind:id`. */
  public readonly connectionReferences = new Map<string, AgentReference[]>();
  /** Every write attempted against the repositories, in call order. */
  public readonly writes: string[] = [];

  /** Captures the state a failed transaction must return to. */
  public checkpoint(): MemoryStoreCheckpoint {
    return {
      roles: [...this.roles],
      departments: [...this.departments],
      accounts: new Map(this.accounts),
      users: new Map(this.users),
      groups: [...this.groups],
    };
  }

  /** Returns to a captured state; the write log is kept on purpose. */
  public restore(checkpoint: MemoryStoreCheckpoint): void {
    this.roles = [...checkpoint.roles];
    this.departments = [...checkpoint.departments];
    this.accounts = new Map(checkpoint.accounts);
    this.users = new Map(checkpoint.users);
    this.groups = [...checkpoint.groups];
  }

  /** Reads the persisted authorization facts, with activity taken from the user row. */
  public readAccounts(): AccountAccess[] {
    return [...this.accounts.values()].map((account) => ({
      ...account,
      // Like the snapshot query: the role is read from the roles table.
      role:
        this.roles.find((role) => role.id === account.role?.id) ?? account.role,
      isActive: this.users.get(account.userId)?.user.isActive ?? false,
    }));
  }
}
