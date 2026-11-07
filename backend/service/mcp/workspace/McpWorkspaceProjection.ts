import { effectiveRemoteRoots } from "@/definition/RemoteConnection";

import type {
  AgentWorkspaceUsage,
  AgentWorkspaceView,
  WorkspaceFolderListing,
  WorkspaceGitHub,
} from "@/definition/AgentWorkspace";
import type {
  RemoteConnectionView,
  RemoteHostKey,
  RemoteTestResult,
  RemoteTestStep,
  RemoteWorkspaceView,
} from "@/definition/RemoteConnection";
import type { McpStoredWorkspace } from "./McpWorkspaceCatalog";
import type {
  McpConnectionResponse,
  McpConnectionTestResponse,
  McpFolderListingResponse,
  McpHostKeyResponse,
  McpTestStepResponse,
  McpWorkspaceGitHub,
  McpWorkspaceResponse,
  McpWorkspaceUsageResponse,
} from "./McpWorkspaceContract";

/** The code of the interface without the `workspace_` prefix its errors carry. */
function withoutPrefix(code: string): string {
  return code.replace(/^workspace_/u, "");
}

/** The GitHub link of the project, reduced to the fields of the interface. */
function projectGitHub(
  github: WorkspaceGitHub | null,
): McpWorkspaceGitHub | null {
  return github ? { repoUrl: github.repoUrl, repoName: github.repoName } : null;
}

function projectLocal(view: AgentWorkspaceView): McpWorkspaceResponse {
  return {
    id: view.id,
    kind: "local",
    name: view.name,
    path: view.path,
    project: { id: view.projectId, name: view.projectName },
    github: projectGitHub(view.github),
    connection: null,
    check: null,
    isCheckOutdated: false,
    isUsable: view.isUsable,
    reason: view.reason === null ? null : withoutPrefix(view.reason),
    revision: view.revision,
    canManage: view.canManage,
  };
}

function projectRemote(view: RemoteWorkspaceView): McpWorkspaceResponse {
  return {
    id: view.id,
    kind: "remote",
    name: view.name,
    path: view.path,
    project: { id: view.projectId, name: view.projectName },
    github: projectGitHub(view.github),
    connection: { id: view.connectionId, name: view.connectionName },
    check: view.check
      ? { checkedAt: view.check.checkedAt, issue: view.check.issue }
      : null,
    isCheckOutdated: view.isCheckOutdated,
    isUsable: view.isUsable,
    reason: view.reason,
    revision: view.revision,
    canManage: view.canManage,
  };
}

/**
 * Builds the workspace object of the interface from the view of its service.
 *
 * @remarks
 * Only the fields of the interface are copied, so the console address and
 * the console right of the page never leave the server.
 *
 * @param stored - The workspace with its view.
 */
export function projectWorkspace(
  stored: McpStoredWorkspace,
): McpWorkspaceResponse {
  return stored.kind === "local"
    ? projectLocal(stored.view)
    : projectRemote(stored.view);
}

/**
 * Builds a usage of the interface.
 *
 * @param usage - What refers to the workspace; names are already limited to administrators.
 */
export function projectUsage(
  usage: AgentWorkspaceUsage,
): McpWorkspaceUsageResponse {
  return { kind: usage.kind, id: usage.id, name: usage.name };
}

/**
 * Builds one level of the folder browser of the interface.
 *
 * @param listing - The level the registry listed.
 */
export function projectFolders(
  listing: WorkspaceFolderListing,
): McpFolderListingResponse {
  return {
    path: listing.path,
    breadcrumbs: listing.breadcrumbs.map(({ name, path }) => ({ name, path })),
    hasSeveralRoots: listing.hasSeveralRoots,
    folders: listing.folders.map(({ name, path }) => ({ name, path })),
    isTruncated: listing.isTruncated,
    selectionIssue:
      listing.selectionIssue === null
        ? null
        : withoutPrefix(listing.selectionIssue),
  };
}

/** A host key as the interface shows it: algorithm and fingerprint, never the key. */
function projectHostKey(hostKey: RemoteHostKey): McpHostKeyResponse {
  return { algorithm: hostKey.algorithm, fingerprint: hostKey.fingerprint };
}

/**
 * Builds the connection object of the interface from the view of its service.
 *
 * @remarks
 * The view carries no secret; the host key is reduced to algorithm and
 * fingerprint, and the console right of the page is left out.
 *
 * @param view - The connection as the account sees it.
 */
export function projectConnection(
  view: RemoteConnectionView,
): McpConnectionResponse {
  return {
    id: view.id,
    name: view.name,
    host: view.host,
    port: view.port,
    username: view.username,
    authMethod: view.authMethod,
    department: { id: view.departmentId, name: view.departmentName },
    hostKey: view.hostKey ? projectHostKey(view.hostKey) : null,
    allowedRoots: [...view.allowedRoots],
    effectiveRoots: [...effectiveRemoteRoots(view.allowedRoots, view.username)],
    lastCheck: view.lastCheck
      ? {
          checkedAt: view.lastCheck.checkedAt,
          stage: view.lastCheck.stage,
          code: view.lastCheck.code,
        }
      : null,
    isChecking: view.isChecking,
    session: {
      status: view.session.status,
      attempts: view.session.attempts,
      maximumAttempts: view.session.maximumAttempts,
      nextAttemptAt: view.session.nextAttemptAt,
      cause: view.session.cause,
      connectedAt: view.session.connectedAt,
    },
    workspaceCount: view.workspaceCount,
    revision: view.revision,
    canManage: view.canManage,
    storedSecrets: view.storedSecrets
      ? {
          password: view.storedSecrets.password,
          privateKey: view.storedSecrets.privateKey,
          passphrase: view.storedSecrets.passphrase,
        }
      : null,
  };
}

function projectStep(step: RemoteTestStep): McpTestStepResponse {
  return { state: step.state, code: step.code };
}

/**
 * Builds the result of a connection test of the interface.
 *
 * @remarks
 * The key the machine presented appears as algorithm and fingerprint only.
 *
 * @param result - What the test found.
 */
export function projectTest(
  result: RemoteTestResult,
): McpConnectionTestResponse {
  return {
    reachability: projectStep(result.reachability),
    hostKey: projectStep(result.hostKey),
    authentication: projectStep(result.authentication),
    presentedHostKey: result.presentedHostKey
      ? projectHostKey(result.presentedHostKey)
      : null,
    testedAt: result.testedAt,
  };
}
