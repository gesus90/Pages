import { ProjectPolicyService } from "@/backend/auth/ProjectPolicyService";
import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { RemoteError } from "@/backend/error/RemoteErrors";

import type { AuthorizationSnapshot } from "@/backend/database/repositories/AuthorizationRepository";
import type { AccountAccess } from "@/definition/Authorization";
import type { Project } from "@/definition/Project";

/**
 * Reads the current account facts before every remote action.
 *
 * @remarks
 * Memberships are read anew each time, so a revoked department blocks the
 * next use at once.
 *
 * @param snapshot - The current authorization snapshot.
 * @param userId - The signed-in person.
 * @returns The active account.
 * @throws {RemoteError} `remote_access_denied` for an unknown or inactive account.
 */
export function requireRemoteAccount(
  snapshot: AuthorizationSnapshot,
  userId: string,
): AccountAccess {
  const actor = snapshot.accounts.find((account) => account.userId === userId);
  if (!actor?.isActive) throw new RemoteError("remote_access_denied");
  return actor;
}

/** Only administrators configure connections and see which secrets are stored. */
export function canManageRemoteConnections(actor: AccountAccess): boolean {
  return new UserPolicyService().isAdministrator(actor);
}

/**
 * A connection is shared with exactly one department; its members may use it.
 *
 * @param actor - The current account.
 * @param departmentId - The department the connection is shared with.
 * @returns Whether the person may use the connection for permitted workspaces.
 */
export function canUseRemoteConnection(
  actor: AccountAccess,
  departmentId: string,
): boolean {
  return (
    canManageRemoteConnections(actor) ||
    (actor.isActive && actor.departments.includes(departmentId))
  );
}

/**
 * A console needs the membership itself: it opens a shell on the machine,
 * which the administrator role does not grant on its own.
 *
 * @param actor - The current account.
 * @param departmentId - The department the connection is shared with.
 * @returns Whether the person may open a console over the connection.
 */
export function canOpenRemoteConsole(
  actor: AccountAccess,
  departmentId: string,
): boolean {
  return actor.isActive && actor.departments.includes(departmentId);
}

function departmentIds(project: Project): readonly string[] {
  return project.departments.map((department) => department.id);
}

/** Opening the project is the same right as for local workspaces. */
export function canReadRemoteProject(
  actor: AccountAccess,
  project: Project,
): boolean {
  return new ProjectPolicyService().canAccess(actor, departmentIds(project));
}

/**
 * Registering a workspace for a project needs the project responsibility of
 * local workspaces; the connection right is checked separately.
 */
export function canManageRemoteProject(
  actor: AccountAccess,
  project: Project,
  isProjectManager: boolean,
): boolean {
  return (
    canReadRemoteProject(actor, project) &&
    new ProjectPolicyService().canManageWorkspaces(actor, {
      departmentIds: departmentIds(project),
      isProjectManager,
    })
  );
}
