import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { WIKI_SCOPE } from "@/definition/Wiki";

import { canManagePage } from "./WikiAccess";
import { WikiPageReader } from "./WikiPageReader";

import type {
  WikiPageRecord,
  WikiRepository,
  WikiTrashEntry,
} from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type { WikiPrivatePlaceholder } from "@/definition/Wiki";
import type { WikiAccess, WikiViewer } from "./WikiAccess";

/** Deletes pages into the trash, restores them and removes them for good. */
export class WikiTrashService {
  private readonly repository: WikiRepository;
  private readonly access: WikiAccess;

  /**
   * Creates the service.
   *
   * @param repository - Wiki persistence.
   * @param access - Resolves who is acting.
   */
  public constructor(repository: WikiRepository, access: WikiAccess) {
    this.repository = repository;
    this.access = access;
  }

  /**
   * Moves a page and its subtree into the trash.
   *
   * @param actor - The signed-in user.
   * @param id - Page identifier.
   * @throws {WikiAccessDeniedError} When the actor does not manage the page.
   */
  public async delete(actor: User, id: string): Promise<void> {
    const viewer = await this.access.resolve(actor);

    await this.repository.transaction(async (repository) => {
      const page = await new WikiPageReader(repository).require(
        viewer.scope,
        id,
      );

      if (!canManagePage(viewer, page)) {
        throw new WikiAccessDeniedError();
      }

      await repository.writes.markDeleted(id, actor.id);
    });
  }

  /**
   * Looks up what an administrator sees of a private page of somebody else.
   *
   * @param actor - The signed-in user.
   * @param id - Page identifier.
   * @returns The placeholder, or `null` when the actor is not an
   * administrator in the admin mode or the page is not a live private page.
   *
   * @remarks
   * Only the identifier and the owner leave the repository, never a title
   * or text (T4.6.10).
   */
  public async findPlaceholder(
    actor: User,
    id: string,
  ): Promise<WikiPrivatePlaceholder | null> {
    const viewer = await this.access.resolve(actor);

    if (!viewer.scope.isAdmin) {
      return null;
    }

    const node = await this.repository.pages.findNode(id);

    if (node?.scope !== WIKI_SCOPE.PRIVATE || node.deletedAt !== null) {
      return null;
    }

    return {
      id: node.id,
      ownerId: node.ownerId,
      ownerName: await this.repository.lookups.findUserName(node.ownerId),
    };
  }

  /**
   * Lists the private pages of one account as placeholders.
   *
   * @param actor - The signed-in user.
   * @param ownerId - Account whose private pages are listed.
   * @returns Placeholders, newest first; empty unless the actor is an
   * administrator in the admin mode.
   */
  public async listPlaceholders(
    actor: User,
    ownerId: string,
  ): Promise<WikiPrivatePlaceholder[]> {
    const viewer = await this.access.resolve(actor);

    if (!viewer.scope.isAdmin) {
      return [];
    }

    const ownerName = await this.repository.lookups.findUserName(ownerId);
    const ids = await this.repository.pages.findPrivateIds(ownerId);

    return ids.map((id) => ({ id, ownerId, ownerName }));
  }

  /**
   * Counts the private pages of every account, for the user management.
   *
   * @param actor - The signed-in user.
   * @returns Account identifier mapped to its number of private pages;
   * empty unless the actor is an administrator in the admin mode.
   */
  public async countPrivatePages(
    actor: User,
  ): Promise<ReadonlyMap<string, number>> {
    const viewer = await this.access.resolve(actor);

    return viewer.scope.isAdmin
      ? this.repository.pages.countPrivateByOwner()
      : new Map();
  }

  /**
   * Lists the private pages of every account as placeholders.
   *
   * @param actor - The signed-in user.
   * @returns Account identifier mapped to its placeholders, newest first;
   * only accounts with at least one private page; empty unless the actor is
   * an administrator in the admin mode.
   */
  public async listAllPlaceholders(
    actor: User,
  ): Promise<Record<string, WikiPrivatePlaceholder[]>> {
    const counts = await this.countPrivatePages(actor);
    const entries = await Promise.all(
      [...counts.keys()].map(
        async (ownerId) =>
          [ownerId, await this.listPlaceholders(actor, ownerId)] as const,
      ),
    );

    return Object.fromEntries(entries);
  }

  /**
   * Deletes a private page of somebody else into the owner's trash.
   *
   * @param actor - The signed-in user; an administrator in the admin mode.
   * @param id - Page identifier.
   * @throws {WikiPageNotFoundError} Unless a placeholder exists for the page.
   */
  public async deletePrivateAsAdministrator(
    actor: User,
    id: string,
  ): Promise<void> {
    const placeholder = await this.findPlaceholder(actor, id);

    if (!placeholder) {
      throw new WikiPageNotFoundError();
    }

    await this.repository.writes.markDeleted(id, actor.id);
  }

  /**
   * Lists the deleted pages the actor may restore.
   *
   * @param actor - The signed-in user.
   * @returns Pages that were deleted as such, newest first.
   *
   * @remarks
   * Owners see their own pages. Whoever manages other people's pages also
   * sees those, except private ones, which only their owner can restore.
   */
  public async list(actor: User): Promise<WikiTrashEntry[]> {
    const viewer = await this.access.resolve(actor);

    return this.repository.pages.listTrash(
      viewer.scope,
      !(viewer.scope.isAdmin || viewer.canManageProjects),
    );
  }

  /**
   * Brings a deleted page back.
   *
   * @param actor - The signed-in user.
   * @param id - Page that was deleted as such.
   * @throws {WikiAccessDeniedError} When the actor does not manage the page.
   * @throws {WikiValidationError} When the page is not in the trash.
   *
   * @remarks
   * A page whose parent is gone or still deleted returns as a root page of
   * its scope.
   */
  public async restore(actor: User, id: string): Promise<void> {
    const viewer = await this.access.resolve(actor);

    await this.repository.transaction(async (repository) => {
      const page = await this.requireTrashed(repository, viewer, id);
      const parent =
        page.parentId === null
          ? null
          : await repository.pages.findNode(page.parentId);
      const parentAlive = parent !== null && parent.deletedAt === null;
      const placement = {
        parentId: parentAlive ? page.parentId : null,
        projectId: page.projectId,
        scope: page.scope,
      };

      await repository.writes.clearDeleted(id);
      await repository.writes.place(
        id,
        placement,
        await repository.writes.nextPosition(placement, page.ownerId),
        actor.id,
      );
    });
  }

  /**
   * Removes a page from the trash for good.
   *
   * @param actor - The signed-in user.
   * @param id - Page that was deleted as such.
   * @returns Storage names of attachment files to remove from the disk.
   * @throws {WikiAccessDeniedError} When the actor does not manage the page.
   * @throws {WikiValidationError} When the page is not in the trash.
   */
  public async purge(actor: User, id: string): Promise<string[]> {
    const viewer = await this.access.resolve(actor);

    return this.repository.transaction(async (repository) => {
      await this.requireTrashed(repository, viewer, id);

      return repository.deletePages({
        parameters: { root_id: id },
        sql: "SELECT id FROM wiki_pages WHERE deleted_root_id = $root_id",
      });
    });
  }

  /**
   * Removes everything that stayed in the trash longer than allowed.
   *
   * @param retentionDays - Days a deleted page stays in the trash.
   * @returns Storage names of attachment files to remove from the disk.
   */
  public async purgeExpired(retentionDays: number): Promise<string[]> {
    return this.repository.transaction(async (repository) => {
      const files: string[] = [];

      for (const rootId of await repository.pages.findExpiredTrashRoots(
        retentionDays,
      )) {
        files.push(
          ...(await repository.deletePages({
            parameters: { root_id: rootId },
            sql: "SELECT id FROM wiki_pages WHERE deleted_root_id = $root_id",
          })),
        );
      }

      return files;
    });
  }

  private async requireTrashed(
    repository: WikiRepository,
    viewer: WikiViewer,
    id: string,
  ): Promise<WikiPageRecord> {
    const page = await repository.pages.findVisible(viewer.scope, id, {
      includeDeleted: true,
    });

    if (!page) {
      throw new WikiPageNotFoundError();
    }

    const node = await repository.pages.findNode(id);

    if (node?.deletedRootId !== id) {
      throw new WikiValidationError("notInTrash");
    }

    if (!canManagePage(viewer, page)) {
      throw new WikiAccessDeniedError();
    }

    return page;
  }
}
