import { CAPABILITY } from "@/definition/Authorization";
import { WIKI_SCOPE } from "@/definition/Wiki";

import type { PermissionService } from "@/backend/auth/PermissionService";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { User } from "@/definition/User";
import type {
  WikiPagePermissions,
  WikiScope,
  WikiVisibilityScope,
} from "@/definition/Wiki";

/** An account together with what it may see and do in the wiki. */
export interface WikiViewer {
  readonly user: User;
  readonly scope: WikiVisibilityScope;
  /** Holds the capability "write", which creating and editing need. */
  readonly canWrite: boolean;
  readonly canManageProjects: boolean;
}

/** The facts of a page that decide what a viewer may do with it. */
export interface WikiPageFacts {
  readonly scope: WikiScope;
  readonly ownerId: string;
}

/** Resolves who is looking at the wiki, from the current account facts. */
export class WikiAccess {
  private readonly projectService: ProjectService;
  private readonly permissionService: PermissionService;

  /**
   * Creates the resolver.
   *
   * @param projectService - Decides which projects an account reads.
   * @param permissionService - Decides the capabilities of an account.
   */
  public constructor(
    projectService: ProjectService,
    permissionService: PermissionService,
  ) {
    this.projectService = projectService;
    this.permissionService = permissionService;
  }

  /**
   * Resolves the viewer from live account facts.
   *
   * @param actor - The signed-in user.
   * @returns The viewer with the scope that filters every wiki read.
   * @throws When the account is inactive or has no access.
   */
  public async resolve(actor: User): Promise<WikiViewer> {
    const visibility = await this.projectService.workItemVisibility(actor);
    const [canWrite, canManageProjects] = await Promise.all([
      this.permissionService.hasCapability(actor, CAPABILITY.WRITE),
      this.permissionService.hasCapability(actor, CAPABILITY.MANAGE_PROJECTS),
    ]);

    return {
      canManageProjects,
      canWrite,
      scope: {
        departmentIds: visibility.departmentIds ?? [],
        isAdmin: visibility.departmentIds === null,
        projectIds: visibility.projectIds ?? [],
        userId: actor.id,
      },
      user: actor,
    };
  }
}

/**
 * Decides what a viewer may do with a page it can see.
 *
 * @param viewer - The viewer.
 * @param page - Scope and owner of the page.
 * @returns Editing needs the capability "write"; managing (moving,
 * deleting, changing anchors) belongs to the owner, to administrators and,
 * for project pages, to whoever manages projects. Private pages belong to
 * their owner alone.
 */
export function describePermissions(
  viewer: WikiViewer,
  page: WikiPageFacts,
): WikiPagePermissions {
  return {
    canComment: true,
    canEdit: viewer.canWrite,
    canManage: canManagePage(viewer, page),
  };
}

/**
 * Tells whether a viewer may move, delete or re-anchor a page.
 *
 * @param viewer - The viewer.
 * @param page - Scope and owner of the page.
 * @returns Whether the viewer manages the page.
 */
export function canManagePage(
  viewer: WikiViewer,
  page: WikiPageFacts,
): boolean {
  if (page.ownerId === viewer.scope.userId) {
    return true;
  }

  if (page.scope === WIKI_SCOPE.PRIVATE) {
    return false;
  }

  return (
    viewer.scope.isAdmin ||
    (page.scope === WIKI_SCOPE.PROJECT && viewer.canManageProjects)
  );
}
