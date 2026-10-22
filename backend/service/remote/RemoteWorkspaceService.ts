import { randomUUID } from "node:crypto";

import { UserPolicyService } from "@/backend/auth/UserPolicyService";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { RemoteError } from "@/backend/error/RemoteErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { effectiveRemoteRoots } from "@/definition/RemoteConnection";

import {
  canManageRemoteProject,
  canReadRemoteProject,
  canUseRemoteConnection,
  requireRemoteAccount,
} from "./RemoteAccess";
import { readRemoteWorkspaceInput } from "./RemoteConnectionInput";
import { checkRemoteDirectory } from "./RemoteDirectoryCheck";

import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type {
  RemoteConnectionRecord,
  RemoteConnectionRepository,
} from "@/backend/database/repositories/remote/RemoteConnectionRepository";
import type {
  RemoteWorkspaceCheckRecord,
  RemoteWorkspaceRecord,
  RemoteWorkspaceRepository,
} from "@/backend/database/repositories/remote/RemoteWorkspaceRepository";
import type { RemoteSessionRegistry } from "@/backend/remote/RemoteSessionRegistry";
import type { RemoteSession } from "@/backend/remote/RemoteSession";
import type { WorkspaceGitHub } from "@/definition/AgentWorkspace";
import type { AccountAccess } from "@/definition/Authorization";
import type { Project, ProjectIntegration } from "@/definition/Project";
import type {
  RemoteFailureDetail,
  RemoteWorkspaceCheck,
  RemoteWorkspaceReason,
  RemoteWorkspaceView,
} from "@/definition/RemoteConnection";

/** Storage, authorization, projects and live connections of remote workspaces. */
export interface RemoteWorkspaceDependencies {
  readonly workspaces: RemoteWorkspaceRepository;
  readonly connections: Pick<RemoteConnectionRepository, "list" | "find">;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly projects: Pick<
    ProjectRepository,
    | "findAll"
    | "findById"
    | "findIntegration"
    | "findIntegrationsByProjectIds"
    | "findManagedProjectIds"
    | "isProjectManager"
  >;
  readonly sessions: RemoteSessionRegistry;
}

/** What a listing needs to describe every visible profile. */
interface ListingContext {
  readonly actor: AccountAccess;
  readonly isAdministrator: boolean;
  readonly connections: ReadonlyMap<string, RemoteConnectionRecord>;
  readonly projects: ReadonlyMap<string, Project>;
  readonly integrations: ReadonlyMap<string, ProjectIntegration>;
  readonly managed: ReadonlySet<string>;
}

function toGitHub(
  integration: ProjectIntegration | null | undefined,
): WorkspaceGitHub | null {
  return integration?.repoUrl
    ? { repoUrl: integration.repoUrl, repoName: integration.repoName }
    : null;
}

/** The rights a change was granted on: the stored profile and the chosen connection. */
interface AuthorizedChange {
  readonly previous: RemoteWorkspaceRecord | null;
  readonly connection: RemoteConnectionRecord;
}

function rootsOf(connection: RemoteConnectionRecord): readonly string[] {
  return effectiveRemoteRoots(connection.allowedRoots, connection.username);
}

function isSameRootSet(
  first: readonly string[],
  second: readonly string[],
): boolean {
  const others = new Set(second);
  const own = new Set(first);
  return own.size === others.size && [...own].every((root) => others.has(root));
}

/**
 * A stored result no longer answers the question when its check applied
 * other allowed directories than the connection has now; a check from before
 * the directories were recorded is treated the same way.
 */
function isCheckOutdated(
  check: RemoteWorkspaceCheckRecord | null,
  connection: RemoteConnectionRecord | undefined,
): boolean {
  if (!check || !connection) return false;
  if (check.roots === null) return true;
  return !isSameRootSet(check.roots, rootsOf(connection));
}

// The applied directories stay on the server; the page only learns whether they are outdated.
function toCheckView(
  check: RemoteWorkspaceCheckRecord | null,
): RemoteWorkspaceCheck | null {
  return check ? { checkedAt: check.checkedAt, issue: check.issue } : null;
}

/** A connection that cannot be opened at the moment leaves the directory unknown, not changed. */
function storesCheckFailure(error: RemoteError): boolean {
  return (
    error.code === "remote_check_failed" ||
    error.code === "remote_transport_lost"
  );
}

/**
 * Registers workspace profiles on remote machines.
 *
 * @remarks
 * A profile has a stable identifier, one connection, one canonical absolute
 * path on that machine and exactly one project, whose GitHub link is shown
 * and used; no second credential store exists. Using a profile needs the
 * project access and the connection's department; changing it also needs
 * the project responsibility of local workspaces. The directory must lie
 * within the connection's allowed directories; it is only inspected, never
 * changed.
 */
export class RemoteWorkspaceService {
  private readonly dependencies: RemoteWorkspaceDependencies;
  private readonly writes = new SerialQueue();

  public constructor(dependencies: RemoteWorkspaceDependencies) {
    this.dependencies = dependencies;
  }

  /** Lists the profiles of projects and connections the person may use. */
  public async list(userId: string): Promise<readonly RemoteWorkspaceView[]> {
    const context = await this.listingContext(userId);
    const records = await this.dependencies.workspaces.list();
    return records
      .filter((record) => this.isVisible(context, record))
      .map((record) => this.view(context, record));
  }

  /** Rechecks actual department membership and project access for every console operation. */
  public async requireConsole(
    userId: string,
    id: string,
  ): Promise<RemoteWorkspaceRecord> {
    const actor = await this.account(userId);
    const record = await this.requireRecord(id);
    const connection = await this.requireUse(actor, record, "inspect");
    if (!actor.departments.includes(connection.departmentId))
      throw new RemoteError("remote_access_denied");
    return record;
  }

  /** Checks the current canonical directory before each new shell, including reconnects. */
  public async consoleTarget(
    userId: string,
    id: string,
  ): Promise<{
    readonly path: string;
    readonly session: RemoteSession;
  }> {
    const record = await this.requireConsole(userId, id);
    const connection = await this.dependencies.connections.find(
      record.connectionId,
    );
    if (!connection) throw new RemoteError("remote_access_denied");
    const session = this.dependencies.sessions.session(record.connectionId);
    const finding = await checkRemoteDirectory(session, {
      path: record.path,
      roots: rootsOf(connection),
    });
    if (finding.issue || finding.path !== record.path)
      throw new RemoteError(
        "remote_check_failed",
        finding.issue ?? "path_changed",
      );
    const current = await this.requireConsole(userId, id);
    const currentConnection = await this.dependencies.connections.find(
      record.connectionId,
    );
    if (
      current.revision !== record.revision ||
      currentConnection?.revision !== connection.revision
    )
      throw new RemoteError("remote_conflict");
    return { path: record.path, session };
  }

  /**
   * Registers or changes a profile after checking its directory over SSH.
   *
   * @param userId - A person responsible for the project who may use the connection.
   * @param id - The profile to change, or `null` for a new one.
   * @param input - Name, connection, path, project and revision.
   * @returns The stable identifier of the profile.
   */
  public async save(
    userId: string,
    id: string | null,
    input: unknown,
  ): Promise<string> {
    const proposed = readRemoteWorkspaceInput(input);
    const { connection } = await this.authorizeChange(userId, id, proposed);
    const finding = await checkRemoteDirectory(
      this.dependencies.sessions.session(proposed.connectionId),
      { path: proposed.path, roots: rootsOf(connection) },
    );
    if (finding.issue !== null || finding.path === null)
      throw new RemoteError(
        "remote_check_failed",
        finding.issue ?? "path_denied",
      );
    const canonicalPath = finding.path;
    return this.writes.run(async () => {
      // Rights are read again after the round trip to the machine.
      const current = await this.authorizeChange(userId, id, proposed);
      // The directory was checked against the allowed directories read before.
      if (current.connection.revision !== connection.revision)
        throw new RemoteError("remote_conflict");
      const { previous } = current;
      const workspaceId = id ?? randomUUID();
      await this.dependencies.workspaces.save(
        {
          id: workspaceId,
          name: proposed.name,
          connectionId: proposed.connectionId,
          path: canonicalPath,
          projectId: proposed.projectId,
          registeredBy: previous?.registeredBy ?? userId,
          check: {
            checkedAt: new Date().toISOString(),
            issue: null,
            roots: rootsOf(connection),
          },
          revision: proposed.revision ?? 1,
        },
        id === null,
      );
      return workspaceId;
    });
  }

  /**
   * Checks a profile's directory again and keeps the result.
   *
   * @param userId - A person who may use the profile.
   * @param id - The profile.
   * @throws {RemoteError} When the connection could not run the check.
   */
  public async check(userId: string, id: string): Promise<void> {
    const actor = await this.account(userId);
    const record = await this.requireRecord(id);
    const connection = await this.requireUse(actor, record, "inspect");
    // Stored with the result, so a list changed during the check marks it outdated.
    const roots = rootsOf(connection);
    let issue: RemoteFailureDetail | null;
    try {
      const finding = await checkRemoteDirectory(
        this.dependencies.sessions.session(record.connectionId),
        { path: record.path, roots },
      );
      issue =
        finding.issue ?? (finding.path === record.path ? null : "path_changed");
    } catch (error: unknown) {
      logCaughtError("RemoteWorkspaceService", error);
      if (error instanceof RemoteError && storesCheckFailure(error))
        await this.dependencies.workspaces.saveCheck(id, record.revision, {
          checkedAt: new Date().toISOString(),
          issue: error.failure ?? "remote_failed",
          roots,
        });
      throw error;
    }
    await this.dependencies.workspaces.saveCheck(id, record.revision, {
      checkedAt: new Date().toISOString(),
      issue,
      roots,
    });
  }

  /**
   * Unregisters a profile; the remote directory stays untouched.
   *
   * @param userId - A person responsible for the project who may use the connection.
   * @param id - The profile.
   * @param revision - The revision read before.
   */
  public async remove(
    userId: string,
    id: string,
    revision: number,
  ): Promise<void> {
    await this.writes.run(async () => {
      const actor = await this.account(userId);
      await this.requireManaged(actor, await this.requireRecord(id));
      await this.dependencies.workspaces.remove(id, revision);
    });
  }

  private async account(userId: string): Promise<AccountAccess> {
    return requireRemoteAccount(
      await this.dependencies.authorization.snapshot(),
      userId,
    );
  }

  private async listingContext(userId: string): Promise<ListingContext> {
    const actor = await this.account(userId);
    const { connections, projects } = this.dependencies;
    const [connectionList, projectList, managedIds] = await Promise.all([
      connections.list(),
      projects.findAll(),
      projects.findManagedProjectIds(userId),
    ]);
    return {
      actor,
      isAdministrator: new UserPolicyService().isAdministrator(actor),
      connections: new Map(connectionList.map((entry) => [entry.id, entry])),
      projects: new Map(projectList.map((entry) => [entry.id, entry])),
      integrations: await projects.findIntegrationsByProjectIds(
        projectList.map((entry) => entry.id),
      ),
      managed: new Set(managedIds),
    };
  }

  private isVisible(
    context: ListingContext,
    record: RemoteWorkspaceRecord,
  ): boolean {
    if (context.isAdministrator) return true;
    const connection = context.connections.get(record.connectionId);
    const project = context.projects.get(record.projectId);
    return (
      connection !== undefined &&
      project !== undefined &&
      canUseRemoteConnection(context.actor, connection.departmentId) &&
      canReadRemoteProject(context.actor, project)
    );
  }

  private view(
    context: ListingContext,
    record: RemoteWorkspaceRecord,
  ): RemoteWorkspaceView {
    const connection = context.connections.get(record.connectionId);
    const project = context.projects.get(record.projectId);
    const github = toGitHub(context.integrations.get(record.projectId));
    const reason = this.reasonOf(record, project, github);
    const canManage =
      context.isAdministrator ||
      (project !== undefined &&
        canManageRemoteProject(
          context.actor,
          project,
          context.managed.has(project.id),
        ));
    return {
      id: record.id,
      name: record.name,
      connectionId: record.connectionId,
      connectionName: connection?.name ?? record.connectionId,
      consoleAddress: connection
        ? `${connection.username}@${connection.host}:${connection.port}`
        : undefined,
      path: record.path,
      projectId: record.projectId,
      projectName: project?.name ?? record.projectId,
      github,
      check: toCheckView(record.check),
      isCheckOutdated: isCheckOutdated(record.check, connection),
      isUsable: reason === null,
      reason,
      revision: record.revision,
      canManage,
      canOpenConsole:
        connection !== undefined &&
        project !== undefined &&
        context.actor.departments.includes(connection.departmentId) &&
        canReadRemoteProject(context.actor, project),
    };
  }

  private reasonOf(
    record: RemoteWorkspaceRecord,
    project: Project | undefined,
    github: WorkspaceGitHub | null,
  ): RemoteWorkspaceReason | null {
    if (!project) return "project_unavailable";
    if (!github) return "github_missing";
    const session = this.dependencies.sessions.view(record.connectionId);
    if (session.status === "blocked") return "connection_blocked";
    if (!record.check) return "unchecked";
    return record.check.issue;
  }

  private async requireRecord(id: string): Promise<RemoteWorkspaceRecord> {
    const record = await this.dependencies.workspaces.find(id);
    if (!record) throw new RemoteError("remote_workspace_not_found");
    return record;
  }

  /** Rights of a change: the stored profile, the chosen project with GitHub, and the connection. */
  private async authorizeChange(
    userId: string,
    id: string | null,
    proposed: { readonly connectionId: string; readonly projectId: string },
  ): Promise<AuthorizedChange> {
    const actor = await this.account(userId);
    const previous = id === null ? null : await this.requireRecord(id);
    if (previous && previous.connectionId !== proposed.connectionId)
      throw new RemoteError("remote_workspace_invalid");
    if (previous) await this.requireManaged(actor, previous);
    await this.requireProjectManagement(actor, proposed.projectId, "assign");
    const connection = await this.requireConnection(
      actor,
      proposed.connectionId,
    );
    return { previous, connection };
  }

  /**
   * A profile the person cannot see behaves like a missing one; a check also
   * needs the pinned host key, an unregistering does not.
   */
  private async requireUse(
    actor: AccountAccess,
    record: RemoteWorkspaceRecord,
    purpose: "inspect" | "keep",
  ): Promise<RemoteConnectionRecord> {
    const [project, connection] = await Promise.all([
      this.dependencies.projects.findById(record.projectId),
      this.dependencies.connections.find(record.connectionId),
    ]);
    if (
      !project ||
      !canReadRemoteProject(actor, project) ||
      !connection ||
      !canUseRemoteConnection(actor, connection.departmentId)
    )
      throw new RemoteError("remote_workspace_not_found");
    if (purpose === "inspect" && !connection.hostKey)
      throw new RemoteError(
        "remote_host_key_unconfirmed",
        "host_key_unconfirmed",
      );
    return connection;
  }

  private async requireManaged(
    actor: AccountAccess,
    record: RemoteWorkspaceRecord,
  ): Promise<void> {
    const isAdministrator = new UserPolicyService().isAdministrator(actor);
    const project = await this.dependencies.projects.findById(record.projectId);
    // Administrators clean up a profile whose project is gone.
    if (!project && isAdministrator) return;
    await this.requireUse(actor, record, "keep");
    await this.requireProjectManagement(actor, record.projectId, "keep");
  }

  private async requireProjectManagement(
    actor: AccountAccess,
    projectId: string,
    purpose: "assign" | "keep",
  ): Promise<void> {
    const { projects } = this.dependencies;
    const project = await projects.findById(projectId);
    if (!project || !canReadRemoteProject(actor, project))
      throw new RemoteError("remote_project_denied");
    const isProjectManager = await projects.isProjectManager(
      project.id,
      actor.userId,
    );
    if (!canManageRemoteProject(actor, project, isProjectManager))
      throw new RemoteError("remote_project_denied");
    // A new assignment needs the GitHub link; keeping one survives a gap in it.
    if (
      purpose === "assign" &&
      !toGitHub(await projects.findIntegration(project.id))
    )
      throw new RemoteError("remote_project_unsupported");
  }

  /** A new assignment needs a connection the person may use, with a pinned host key. */
  private async requireConnection(
    actor: AccountAccess,
    connectionId: string,
  ): Promise<RemoteConnectionRecord> {
    const connection = await this.dependencies.connections.find(connectionId);
    if (!connection || !canUseRemoteConnection(actor, connection.departmentId))
      throw new RemoteError("remote_access_denied");
    if (!connection.hostKey)
      throw new RemoteError(
        "remote_host_key_unconfirmed",
        "host_key_unconfirmed",
      );
    return connection;
  }
}
