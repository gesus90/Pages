import { WikiValidationError } from "@/backend/error/WikiErrors";
import { WIKI_ANCHOR_KIND, WIKI_SCOPE } from "@/definition/Wiki";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type {
  WikiAnchor,
  WikiPlacementScope,
  WikiVisibilityScope,
} from "@/definition/Wiki";

/**
 * Checks the anchors a page is tied to and removes duplicates.
 *
 * @param repository - Wiki persistence.
 * @param viewer - What the person who ties the page may see.
 * @param placement - Scope and project the page ends up in.
 * @param anchors - Requested anchors.
 * @returns The anchors without duplicates.
 * @throws {WikiValidationError} When a target does not exist, the person
 * cannot see it, or it does not fit the page.
 *
 * @remarks
 * Tying a page needs only reading the target (T4.6.5). Private pages carry
 * no anchors, and a project page can only be tied to targets of its project.
 */
export async function validateAnchors(
  repository: WikiRepository,
  viewer: WikiVisibilityScope,
  placement: WikiPlacementScope,
  anchors: readonly WikiAnchor[],
): Promise<WikiAnchor[]> {
  const unique = new Map(
    anchors.map((anchor) => [`${anchor.kind}:${anchor.targetId}`, anchor]),
  );

  if (placement.scope === WIKI_SCOPE.PRIVATE && unique.size > 0) {
    throw new WikiValidationError("invalidAnchor");
  }

  for (const anchor of unique.values()) {
    await requireVisibleTarget(repository, viewer, placement, anchor);
  }

  return [...unique.values()];
}

async function requireVisibleTarget(
  repository: WikiRepository,
  viewer: WikiVisibilityScope,
  placement: WikiPlacementScope,
  anchor: WikiAnchor,
): Promise<void> {
  const target = await repository.anchors.findAnchorTarget(
    anchor.kind,
    anchor.targetId,
  );

  if (!target) {
    throw new WikiValidationError("invalidAnchor");
  }

  if (anchor.kind === WIKI_ANCHOR_KIND.DEPARTMENT) {
    if (!viewer.isAdmin && !viewer.departmentIds.includes(anchor.targetId)) {
      throw new WikiValidationError("invalidAnchor");
    }

    return;
  }

  const sameProject =
    placement.scope !== WIKI_SCOPE.PROJECT ||
    target.projectId === placement.projectId;
  const readsProject =
    target.projectId !== null && viewer.projectIds.includes(target.projectId);
  const readsDepartment =
    viewer.isAdmin ||
    target.departmentId === null ||
    viewer.departmentIds.includes(target.departmentId);

  if (!sameProject || !readsProject || !readsDepartment) {
    throw new WikiValidationError("invalidAnchor");
  }
}
