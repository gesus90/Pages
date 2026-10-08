import {
  WikiAccessDeniedError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import {
  compareAudience,
  compareInheritedAnchors,
  WIKI_ANCHOR_KIND,
  WIKI_SCOPE,
} from "@/definition/Wiki";

import { canManagePage } from "./WikiAccess";
import { WikiPageReader } from "./WikiPageReader";
import { requireDepth, resolvePlacement } from "./WikiPlacementResolver";

import type {
  WikiPageRecord,
  WikiPlacement,
  WikiRepository,
} from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type { WikiScope, WikiVisibilityChange } from "@/definition/Wiki";
import type { WikiAccess, WikiViewer } from "./WikiAccess";
import type { PlacementRequest } from "./WikiPlacementResolver";

/** Where to move a page and, optionally, before which sibling. */
export interface MoveWikiPageInput extends PlacementRequest {
  /** Sibling the page is placed before; `null` appends it. */
  readonly beforeId: string | null;
}

/** Moves and reorders pages. */
export class WikiMoveService {
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
   * Tells how a move would change who sees the page, without moving it.
   *
   * @param actor - The signed-in user.
   * @param id - Page identifier.
   * @param input - The intended place.
   * @returns The direction of the change.
   * @throws {WikiAccessDeniedError} When the actor does not manage the page.
   * @throws {WikiValidationError} When the place is not allowed.
   */
  public async preview(
    actor: User,
    id: string,
    input: MoveWikiPageInput,
  ): Promise<WikiVisibilityChange> {
    const viewer = await this.access.resolve(actor);

    return this.repository.transaction(async (repository) => {
      const page = await this.requireMovable(repository, viewer, id);
      const placement = await this.resolveTarget(
        repository,
        viewer,
        page,
        input,
      );

      const change = compareAudience(page, placement);

      return change === "same"
        ? compareInheritedAnchors(
            await this.inheritedAnchors(repository, page.parentId),
            await this.inheritedAnchors(repository, placement.parentId),
          )
        : change;
    });
  }

  /**
   * Moves a page with its subtree.
   *
   * @param actor - The signed-in user.
   * @param id - Page identifier.
   * @param input - The new place.
   * @throws {WikiAccessDeniedError} When the actor does not manage the page
   * or cannot write.
   * @throws {WikiValidationError} When the place is not allowed, would form
   * a cycle or get the tree too deep.
   *
   * @remarks
   * The subtree takes the scope of the new place. Milestone and epic anchors
   * belong to a project, so they are dropped when the project changes; a
   * private page carries no anchors at all.
   */
  public async move(
    actor: User,
    id: string,
    input: MoveWikiPageInput,
  ): Promise<void> {
    const viewer = await this.access.resolve(actor);

    await this.repository.transaction(async (repository) => {
      const page = await this.requireMovable(repository, viewer, id);
      const placement = await this.resolveTarget(
        repository,
        viewer,
        page,
        input,
      );
      const siblings = (
        await repository.writes.findSiblingIds(placement, page.ownerId)
      ).filter((siblingId) => siblingId !== id);
      const index = siblings.indexOf(input.beforeId ?? "");

      if (input.beforeId !== null && index < 0) {
        throw new WikiValidationError("invalidPosition");
      }

      await repository.writes.place(id, placement, 0, viewer.user.id);
      await repository.writes.applyScopeToDescendants(id, placement);
      await this.dropForeignAnchors(repository, id, page, placement);
      siblings.splice(index < 0 ? siblings.length : index, 0, id);
      await repository.writes.writePositions(siblings);
    });
  }

  private async requireMovable(
    repository: WikiRepository,
    viewer: WikiViewer,
    id: string,
  ): Promise<WikiPageRecord> {
    const page = await new WikiPageReader(repository).require(viewer.scope, id);

    if (!viewer.canWrite || !canManagePage(viewer, page)) {
      throw new WikiAccessDeniedError();
    }

    return page;
  }

  private async resolveTarget(
    repository: WikiRepository,
    viewer: WikiViewer,
    page: WikiPageRecord,
    input: MoveWikiPageInput,
  ): Promise<WikiPlacement> {
    const resolved = await resolvePlacement(repository, viewer, input);
    const subtree = await repository.pages.findSubtreeIds(page.id);

    if (
      resolved.placement.parentId !== null &&
      subtree.includes(resolved.placement.parentId)
    ) {
      throw new WikiValidationError("invalidParent");
    }

    if (
      resolved.placement.scope === WIKI_SCOPE.PRIVATE &&
      page.ownerId !== viewer.scope.userId
    ) {
      throw new WikiValidationError("invalidScope");
    }

    requireDepth(
      resolved.level,
      await repository.pages.countLevelsBelow(page.id),
    );

    return resolved.placement;
  }

  private async dropForeignAnchors(
    repository: WikiRepository,
    id: string,
    page: WikiPageRecord,
    placement: { readonly scope: WikiScope; readonly projectId: string | null },
  ): Promise<void> {
    if (placement.scope === WIKI_SCOPE.PRIVATE) {
      await repository.anchors.removeAnchorsOfSubtree(
        id,
        Object.values(WIKI_ANCHOR_KIND),
      );

      return;
    }

    if (placement.projectId !== page.projectId) {
      await repository.anchors.removeAnchorsOfSubtree(id, [
        WIKI_ANCHOR_KIND.MILESTONE,
        WIKI_ANCHOR_KIND.EPIC,
      ]);
    }
  }

  /** Lists the anchors of a page and of everything above it, as keys. */
  private async inheritedAnchors(
    repository: WikiRepository,
    parentId: string | null,
  ): Promise<ReadonlySet<string>> {
    if (parentId === null) {
      return new Set();
    }

    const chain = [
      parentId,
      ...(await repository.pages.findBreadcrumb(parentId)).map(({ id }) => id),
    ];
    const anchors = await Promise.all(
      chain.map((id) => repository.anchors.findAnchors(id)),
    );

    return new Set(
      anchors.flat().map(({ kind, targetId }) => `${kind}:${targetId}`),
    );
  }
}
