import { effectiveRemoteRoots } from "@/definition/RemoteConnection";

import type { ValidatedRemoteConnection } from "@/backend/service/remote/RemoteConnectionInput";
import type {
  RemoteConnectionView,
  RemoteHostKey,
  RemoteTestResult,
  RemoteWorkspaceView,
} from "@/definition/RemoteConnection";
import type {
  McpConnectionChangeKind,
  McpConnectionChangeQuestion,
} from "./McpWorkspaceContract";

/**
 * A path lies inside a root when it equals the root or starts with `<root>/`.
 *
 * @remarks
 * The root `/` holds every absolute path, as it does for the check over SSH.
 */
function isInsideRoots(path: string, roots: readonly string[]): boolean {
  return roots.some(
    (root) => root === "/" || path === root || path.startsWith(`${root}/`),
  );
}

/** The order of the directories does not matter, only which ones there are. */
function isSameSet(
  first: readonly string[],
  second: readonly string[],
): boolean {
  const others = new Set(second);
  const own = new Set(first);
  return own.size === others.size && [...own].every((root) => others.has(root));
}

/**
 * Finds the workspaces a change of the allowed directories would leave outside them.
 *
 * @param stored - The connection before the change.
 * @param validated - The connection as it would be stored.
 * @param workspaces - The workspaces of the connection.
 */
function workspacesOutsideNewRoots(
  stored: RemoteConnectionView,
  validated: ValidatedRemoteConnection,
  workspaces: readonly RemoteWorkspaceView[],
): readonly RemoteWorkspaceView[] {
  const before = effectiveRemoteRoots(stored.allowedRoots, stored.username);
  const after = effectiveRemoteRoots(
    validated.allowedRoots,
    validated.username,
  );
  if (isSameSet(before, after)) return [];
  return workspaces.filter(
    (workspace) => !isInsideRoots(workspace.path, after),
  );
}

/**
 * Decides whether a change of a connection needs a confirmation first.
 *
 * @remarks
 * Two changes do: allowed directories that would leave a workspace of the
 * connection outside them, and another department. The first affects the
 * workspaces outside the new directories, the second all of them.
 *
 * @param stored - The connection before the change.
 * @param validated - The connection as it would be stored.
 * @param workspaces - The workspaces of the connection.
 * @returns The question with its scope, or `null` when nothing risky changes.
 */
export function connectionChangeQuestion(
  stored: RemoteConnectionView,
  validated: ValidatedRemoteConnection,
  workspaces: readonly RemoteWorkspaceView[],
): McpConnectionChangeQuestion | null {
  const outside = workspacesOutsideNewRoots(stored, validated, workspaces);
  const changesDepartment = stored.departmentId !== validated.departmentId;
  const changes: McpConnectionChangeKind[] = [];
  if (outside.length > 0) changes.push("allowed_roots");
  if (changesDepartment) changes.push("department");
  if (changes.length === 0) return null;
  const affected = changesDepartment ? workspaces : outside;
  return {
    confirmationRequired: true,
    connection: { id: stored.id, name: stored.name },
    changes,
    affectedWorkspaces: affected.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
      project: { id: workspace.projectId, name: workspace.projectName },
    })),
  };
}

/**
 * Reads the host key the machine showed, if its fingerprint is the one given.
 *
 * @remarks
 * Only a key the server itself presented can be pinned, and only for an
 * exactly equal fingerprint, so a client can pin a key just by knowing it.
 *
 * @param result - A connection test that has seen the machine.
 * @param fingerprint - The `SHA256:` fingerprint the client expects.
 * @returns The key as `algorithm base64`, or `null` for another key or none.
 */
export function confirmedHostKeyLine(
  result: Pick<RemoteTestResult, "presentedHostKey">,
  fingerprint: string,
): string | null {
  const presented: RemoteHostKey | null = result.presentedHostKey;
  if (presented === null || presented.fingerprint !== fingerprint) return null;
  return `${presented.algorithm} ${presented.key}`;
}
