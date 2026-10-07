import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { AdministrationError } from "@/backend/error/AdministrationError";
import { MAX_GROUP_NAME_LENGTH } from "@/definition/UserGroup";

import { activeAccount, requireAdministration } from "./AdministrationAccess";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type {
  AuthorizationRepository,
  AuthorizationSnapshot,
} from "@/backend/database/repositories/AuthorizationRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { GroupPageData, UserGroup } from "@/definition/UserGroup";

function membersOf(
  snapshot: AuthorizationSnapshot,
  memberIds: readonly string[],
): AccountAccess[] {
  return snapshot.accounts.filter((account) =>
    memberIds.includes(account.userId),
  );
}

/** Validates a group before it is stored: a name, a free name and active members. */
function validateGroup(
  snapshot: AuthorizationSnapshot,
  existing: readonly UserGroup[],
  input: UserGroup,
): void {
  const name = input.name.trim();
  const memberIds = new Set(input.memberIds);
  const members = membersOf(snapshot, input.memberIds);

  if (
    name.length === 0 ||
    name.length > MAX_GROUP_NAME_LENGTH ||
    memberIds.size === 0 ||
    members.length !== memberIds.size ||
    members.some((member) => !member.isActive) ||
    existing.some(
      (group) =>
        group.id !== input.id &&
        group.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new AdministrationError("invalidInput");
  }
}

/** Manages user groups within the directory scope of the people who manage users. */
export class GroupAdministrationService {
  private readonly policy = new UserPolicyService();
  private readonly repository: AuthorizationRepository;
  private readonly cache: ServerCache;

  /**
   * Binds group management to the aggregate transaction.
   *
   * @param repository - Authorization repository, possibly inside a transaction.
   * @param cache - Server cache invalidated by assignment-relevant changes.
   */
  public constructor(repository: AuthorizationRepository, cache: ServerCache) {
    this.repository = repository;
    this.cache = cache;
  }

  /** Lists the groups the actor may see, with edit hints from the same policy. */
  public async pageData(userId: string): Promise<GroupPageData> {
    return this.repository.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      const actor = activeAccount(snapshot, userId);

      if (!this.policy.canManageGroups(actor)) {
        return { canManage: false, groups: [] };
      }

      const groups = await repository.groups().findAll();

      return {
        canManage: true,
        groups: groups.flatMap((group) => {
          const members = membersOf(snapshot, group.memberIds);

          if (!this.policy.canSeeGroup(actor, members)) {
            return [];
          }

          return [
            {
              canEdit: this.policy.canChangeGroup(actor, members),
              id: group.id,
              memberCount: group.memberIds.length,
              memberIds: members
                .filter((member) => this.policy.canSee(actor, member))
                .map((member) => member.userId),
              name: group.name,
            },
          ];
        }),
      };
    });
  }

  /**
   * Creates or changes a group.
   *
   * @param userId - Acting user, resolved against current persisted facts.
   * @param input - Group id, name and the complete new member list.
   * @throws {AdministrationError} When the actor lacks scope or the input is invalid.
   */
  public async saveGroup(userId: string, input: UserGroup): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      const actor = activeAccount(snapshot, userId);
      const groups = await repository.groups().findAll();
      const current = groups.find((group) => group.id === input.id);

      requireAdministration(
        this.policy.canChangeGroup(actor, [
          ...membersOf(snapshot, current?.memberIds ?? []),
          ...membersOf(snapshot, input.memberIds),
        ]),
      );
      validateGroup(snapshot, groups, input);
      await repository.groups().save({ ...input, name: input.name.trim() });
    });
    this.cache.invalidateWorkItems();
  }

  /**
   * Deletes a group and removes its ticket assignments.
   *
   * @param userId - Acting user, resolved against current persisted facts.
   * @param groupId - Group to delete.
   * @throws {AdministrationError} When the group does not exist or is out of scope.
   */
  public async deleteGroup(userId: string, groupId: string): Promise<void> {
    await this.repository.transaction(async (repository) => {
      const snapshot = await repository.snapshot();
      const actor = activeAccount(snapshot, userId);
      const group = (await repository.groups().findAll()).find(
        (candidate) => candidate.id === groupId,
      );

      if (!group) {
        throw new AdministrationError("notFound");
      }

      requireAdministration(
        this.policy.canChangeGroup(actor, membersOf(snapshot, group.memberIds)),
      );
      await repository.groups().delete(groupId);
    });
    this.cache.invalidateWorkItems();
  }
}
