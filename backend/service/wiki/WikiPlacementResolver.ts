import { WikiValidationError } from "@/backend/error/WikiErrors";
import { isWikiScope, WIKI_LIMITS, WIKI_SCOPE } from "@/definition/Wiki";

import { WikiPageReader } from "./WikiPageReader";

import type {
  WikiPlacement,
  WikiPageRecord,
  WikiRepository,
} from "@/backend/database/repositories/WikiRepository";
import type { WikiScope } from "@/definition/Wiki";
import type { WikiViewer } from "./WikiAccess";

/** Where a page is supposed to go, as requested. */
export interface PlacementRequest {
  /** Page above, or `null` for a root page. */
  readonly parentId: string | null;
  /** Scope of a root page; ignored below a parent, which decides it. */
  readonly scope: WikiScope | null;
  /** Project of a project page. */
  readonly projectId: string | null;
}

/** A requested place after validation. */
export interface ResolvedPlacement {
  readonly placement: WikiPlacement;
  readonly parent: WikiPageRecord | null;
  /** Level of the page in the tree; a root page has level 1. */
  readonly level: number;
}

/**
 * Resolves a requested place and checks that the viewer may use it.
 *
 * @param repository - Wiki persistence.
 * @param viewer - The person who places the page.
 * @param request - The requested place.
 * @returns The place, the parent and the level a page there would have.
 * @throws {WikiValidationError} When the place is not allowed.
 *
 * @remarks
 * A page below a parent takes the scope and project of the parent, so a
 * child is never visible to more people than its parent (T4.6.1).
 */
export async function resolvePlacement(
  repository: WikiRepository,
  viewer: WikiViewer,
  request: PlacementRequest,
): Promise<ResolvedPlacement> {
  if (request.parentId !== null) {
    return resolveBelowParent(repository, viewer, request.parentId);
  }

  const { scope, projectId } = request;

  if (!isWikiScope(scope)) {
    throw new WikiValidationError("invalidScope");
  }

  if (scope === WIKI_SCOPE.PROJECT) {
    if (projectId === null || !viewer.scope.projectIds.includes(projectId)) {
      throw new WikiValidationError("invalidScope");
    }

    return root({ parentId: null, projectId, scope });
  }

  return root({ parentId: null, projectId: null, scope });
}

function root(placement: WikiPlacement): ResolvedPlacement {
  return { level: 1, parent: null, placement };
}

async function resolveBelowParent(
  repository: WikiRepository,
  viewer: WikiViewer,
  parentId: string,
): Promise<ResolvedPlacement> {
  const parent = await new WikiPageReader(repository).require(
    viewer.scope,
    parentId,
  );

  if (parent.isTemplate) {
    throw new WikiValidationError("invalidParent");
  }

  const levelsAbove = await repository.pages.countLevelsAbove(parentId);

  return {
    level: levelsAbove + 2,
    parent,
    placement: {
      parentId,
      projectId: parent.projectId,
      scope: parent.scope,
    },
  };
}

/**
 * Checks that a subtree fits below a place.
 *
 * @param level - Level the top of the subtree would have.
 * @param levelsBelow - Number of levels below the top of the subtree.
 * @throws {WikiValidationError} When the tree would get deeper than allowed.
 */
export function requireDepth(level: number, levelsBelow: number): void {
  if (level + levelsBelow > WIKI_LIMITS.treeDepth) {
    throw new WikiValidationError("treeTooDeep");
  }
}
