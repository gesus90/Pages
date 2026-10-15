import { AgentConnectionScopeRepository } from "@/backend/database/repositories/agent/AgentConnectionScopeRepository";
import { AgentProfileStore } from "@/backend/database/repositories/agent/AgentProfileStore";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";

import {
  UNUSED_DATABASE,
  MemoryUserRepository,
} from "./memory-user-repository";

import type { AuthorizationSnapshot } from "@/backend/database/repositories/AuthorizationRepository";
import type { AgentConnectionScopeTarget } from "@/definition/AgentConnectionScope";
import type { AgentProfileTarget } from "@/definition/AgentProfile";
import type { AgentReference } from "@/definition/AgentUsage";
import type {
  AccountAccess,
  Department,
  UserRole,
} from "@/definition/Authorization";
import type { GroupSummary, UserGroup } from "@/definition/UserGroup";

import type { MemoryAuthorizationStore } from "./memory-authorization-store";

const UNUSED_CONNECTION = {
  query: UNUSED_DATABASE.query,
  execute: UNUSED_DATABASE.execute,
};

/** Group persistence held in the memory store. */
class MemoryGroupRepository extends UserGroupRepository {
  private readonly store: MemoryAuthorizationStore;

  /** Binds the fake to the memory store. */
  public constructor(store: MemoryAuthorizationStore) {
    super(UNUSED_DATABASE);
    this.store = store;
  }

  /** Reads every stored row. */
  public override async findAll(): Promise<UserGroup[]> {
    return [...this.store.groups];
  }

  /** Summarizes the stored groups. */
  public override async findSummaries(): Promise<GroupSummary[]> {
    return this.store.groups.map((group) => ({
      id: group.id,
      name: group.name,
      memberCount: group.memberIds.length,
    }));
  }

  /** Stores or replaces a group. */
  public override async save(group: UserGroup): Promise<void> {
    this.store.writes.push(`groups.save:${group.id}`);
    this.store.groups = [
      ...this.store.groups.filter((candidate) => candidate.id !== group.id),
      group,
    ];
  }

  /** Removes a group. */
  public override async delete(id: string): Promise<void> {
    this.store.writes.push(`groups.delete:${id}`);
    this.store.groups = this.store.groups.filter((group) => group.id !== id);
  }
}

/** Agent profile references answered from the memory store. */
class MemoryAgentProfileStore extends AgentProfileStore {
  private readonly store: MemoryAuthorizationStore;

  /** Binds the fake to the memory store. */
  public constructor(store: MemoryAuthorizationStore) {
    super(UNUSED_CONNECTION);
    this.store = store;
  }

  /** Names the agents or connections that reference a target. */
  public override async references(
    target: AgentProfileTarget,
  ): Promise<readonly AgentReference[]> {
    return (
      this.store.agentProfileReferences.get(
        `${target.kind}:${target.targetId}`,
      ) ?? []
    );
  }
}

/** Connection scope references answered from the memory store. */
class MemoryConnectionScopes extends AgentConnectionScopeRepository {
  private readonly store: MemoryAuthorizationStore;

  /** Binds the fake to the memory store. */
  public constructor(store: MemoryAuthorizationStore) {
    super(UNUSED_CONNECTION);
    this.store = store;
  }

  /** Names the agents or connections that reference a target. */
  public override async references(
    target: AgentConnectionScopeTarget,
  ): Promise<readonly AgentReference[]> {
    return (
      this.store.connectionReferences.get(
        `${target.kind}:${target.targetId}`,
      ) ?? []
    );
  }
}

/**
 * Authorization aggregate backed by the memory store.
 *
 * @remarks
 * A transaction rolls the store back when its work throws, like the database.
 */
export class MemoryAuthorizationRepository extends AuthorizationRepository {
  private readonly store: MemoryAuthorizationStore;

  /** Binds the fake to the memory store. */
  public constructor(store: MemoryAuthorizationStore) {
    super(UNUSED_DATABASE);
    this.store = store;
  }

  /** Runs the work and restores the store when it throws. */
  public override async transaction<Result>(
    work: (repository: AuthorizationRepository) => Promise<Result>,
  ): Promise<Result> {
    const checkpoint = this.store.checkpoint();

    try {
      return await work(this);
    } catch (error: unknown) {
      this.store.restore(checkpoint);
      throw error;
    }
  }

  /** Shares user persistence of the same store. */
  public override users(): MemoryUserRepository {
    return new MemoryUserRepository(this.store);
  }

  /** Shares group persistence of the same store. */
  public override groups(): UserGroupRepository {
    return new MemoryGroupRepository(this.store);
  }

  /** Answers agent profile references from the store. */
  public override agentProfiles(): AgentProfileStore {
    return new MemoryAgentProfileStore(this.store);
  }

  /** Answers connection scope references from the store. */
  public override agentConnectionScopes(): AgentConnectionScopeRepository {
    return new MemoryConnectionScopes(this.store);
  }

  /** Reads the current facts of the aggregate. */
  public override async snapshot(): Promise<AuthorizationSnapshot> {
    return {
      roles: [...this.store.roles],
      departments: [...this.store.departments],
      accounts: this.store.readAccounts(),
    };
  }

  /** Stores or replaces a role. */
  public override async saveRole(role: UserRole): Promise<void> {
    this.store.writes.push(`saveRole:${role.id}`);
    this.store.roles = [
      ...this.store.roles.filter((candidate) => candidate.id !== role.id),
      role,
    ];
  }

  /** Removes a role. */
  public override async deleteRole(id: string): Promise<void> {
    this.store.writes.push(`deleteRole:${id}`);
    this.store.roles = this.store.roles.filter((role) => role.id !== id);
  }

  /** Stores or replaces a department. */
  public override async saveDepartment(department: Department): Promise<void> {
    this.store.writes.push(`saveDepartment:${department.id}`);
    this.store.departments = [
      ...this.store.departments.filter(
        (candidate) => candidate.id !== department.id,
      ),
      department,
    ];
  }

  /** Removes a department with its memberships and ranges. */
  public override async deleteDepartment(id: string): Promise<void> {
    this.store.writes.push(`deleteDepartment:${id}`);
    this.store.departments = this.store.departments.filter(
      (department) => department.id !== id,
    );
    // Deleting a department removes its memberships and management ranges.
    this.store.accounts = new Map(
      [...this.store.accounts].map(([userId, account]) => [
        userId,
        {
          ...account,
          departments: account.departments.filter((entry) => entry !== id),
          managedDepartments: account.managedDepartments.filter(
            (entry) => entry !== id,
          ),
        },
      ]),
    );
  }

  /** Stores account facts; the historical membership flag stays set. */
  public override async saveAccount(account: AccountAccess): Promise<void> {
    this.store.writes.push(`saveAccount:${account.userId}`);

    const previous = this.store.accounts.get(account.userId);

    // The historical membership flag is sticky, like in the real repository.
    this.store.accounts.set(account.userId, {
      ...account,
      hasHadDepartment:
        previous?.hasHadDepartment === true ||
        account.hasHadDepartment ||
        account.departments.length > 0,
    });
  }
}
