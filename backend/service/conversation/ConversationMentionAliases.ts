import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import {
  conversationAliasName,
  CONVERSATION_ALL_ALIASES,
} from "@/definition/ConversationMention";

import type {
  AuthorizationRepository,
  AuthorizationSnapshot,
} from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroup } from "@/definition/UserGroup";
import type { ConversationMentionAlias } from "@/definition/ConversationMention";

/** A single reading of alias visibility, reused for all messages of a history. */
export class ConversationAliasDirectory {
  private readonly snapshot: AuthorizationSnapshot;
  private readonly groups: readonly UserGroup[];
  private readonly policy = new UserPolicyService();

  /** Binds one consistent authorization snapshot to group memberships. */
  public constructor(
    snapshot: AuthorizationSnapshot,
    groups: readonly UserGroup[],
  ) {
    this.snapshot = snapshot;
    this.groups = groups;
  }

  /** Uses directory visibility and own memberships without granting management rights. */
  public forPerson(personId: string): ConversationMentionAlias[] {
    const actor = this.snapshot.accounts.find(
      (entry) => entry.userId === personId,
    );
    if (!actor?.isActive) return [];
    const visibleAccounts = this.snapshot.accounts.filter((entry) =>
      this.policy.canSee(actor, entry),
    );
    const departments = this.snapshot.departments.filter(
      (department) =>
        this.policy.isAdministrator(actor) ||
        actor.departments.includes(department.id) ||
        this.policy.canManageDepartment(actor, department.id) ||
        visibleAccounts.some((entry) =>
          entry.departments.includes(department.id),
        ),
    );
    const groups = this.groups.filter(
      (group) =>
        group.memberIds.includes(personId) ||
        (this.policy.canManageGroups(actor) &&
          this.policy.canSeeGroup(
            actor,
            this.snapshot.accounts.filter((entry) =>
              group.memberIds.includes(entry.userId),
            ),
          )),
    );
    return [
      ...groups.map((group): ConversationMentionAlias => ({
        name: conversationAliasName(group.name),
        memberIds: group.memberIds,
        kind: "group",
      })),
      ...departments.map((department): ConversationMentionAlias => ({
        name: conversationAliasName(department.name),
        kind: "department",
        memberIds: this.snapshot.accounts
          .filter((entry) => entry.departments.includes(department.id))
          .map((entry) => entry.userId),
      })),
    ].filter(
      (alias) =>
        alias.name !== "" && !CONVERSATION_ALL_ALIASES.includes(alias.name),
    );
  }
}

/** Reads organization aliases behind the existing authorization repository. */
export class ConversationMentionAliases {
  private readonly repository: Pick<
    AuthorizationRepository,
    "snapshot" | "groups"
  >;

  /** Reuses organization persistence without opening a new access boundary. */
  public constructor(
    repository: Pick<AuthorizationRepository, "snapshot" | "groups">,
  ) {
    this.repository = repository;
  }

  /** Reads current memberships and permissions; callers never receive the raw snapshot. */
  public async read(): Promise<ConversationAliasDirectory> {
    const [snapshot, groups] = await Promise.all([
      this.repository.snapshot(),
      this.repository.groups().findAll(),
    ]);
    return new ConversationAliasDirectory(snapshot, groups);
  }
}
