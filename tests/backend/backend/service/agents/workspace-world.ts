import path from "node:path";

import { AgentError } from "@/backend/error/AgentErrors";
import { AgentWorkspaceOperationService } from "@/backend/service/agents/AgentWorkspaceOperationService";
import { AgentWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";
import { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import { CAPABILITY } from "@/definition/Authorization";
import { GITHUB_SYNC_INTERVAL, PROJECT_STATUS } from "@/definition/Project";

import { memoryFilesystem } from "./memory-filesystem";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { WorkspaceJournal } from "@/backend/database/repositories/agent/AgentWorkspaceRepository";
import type { AgentWorkspaceDependencies } from "@/backend/service/agents/AgentWorkspaceService";
import type {
  AgentWorkspace,
  AgentWorkspaceUsage,
} from "@/definition/AgentWorkspace";
import type { AccountAccess, Capability } from "@/definition/Authorization";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { Project, ProjectIntegration } from "@/definition/Project";

/** The Pages data folder; it holds the database and is never a workspace. */
export const DATA_DIRECTORY = "/srv/pages/data";
/** The folder of agent files, kept apart from the data folder. */
export const AGENTS_DIRECTORY = "/srv/pages/agents";

/** What a test says about a person; everything else is the plainest account. */
export interface PersonOptions {
  readonly isAdmin?: boolean;
  readonly mode?: "admin" | "role";
  readonly isActive?: boolean;
  readonly capabilities?: readonly Capability[];
  readonly departments?: readonly string[];
  readonly managedDepartments?: readonly string[];
  readonly allProjects?: boolean;
  readonly isDepartmentBound?: boolean;
}

/** What a test says about a project. */
export interface ProjectOptions {
  readonly departments?: readonly string[];
  /** The GitHub repository of the project; `null` leaves it unlinked. */
  readonly github?: string | null;
}

/** A registration a test starts from, placed without any operation. */
export interface SeededWorkspace {
  readonly name?: string;
  readonly path: string;
  readonly projectId: string;
}

function account(userId: string, options: PersonOptions): AccountAccess {
  return {
    userId,
    role: {
      id: "role",
      name: "Role",
      rank: 10,
      departmentBound: options.isDepartmentBound ?? false,
      permissions: options.capabilities ?? [CAPABILITY.WRITE],
    },
    isAdmin: options.isAdmin ?? false,
    mode: options.mode ?? "role",
    firstName: userId,
    lastName: "Tester",
    isActive: options.isActive ?? true,
    departments: options.departments ?? [],
    managedDepartments: options.managedDepartments ?? [],
    allDepartments: false,
    allProjects: options.allProjects ?? false,
    hasHadDepartment: false,
  };
}

function project(id: string, options: ProjectOptions): Project {
  return {
    id,
    departments: (options.departments ?? []).map((department) => ({
      id: department,
      name: department,
    })),
    parentId: null,
    name: `Project ${id}`,
    description: "",
    status: PROJECT_STATUS.ACTIVE,
    progress: 0,
    placeholderColor: "#336699",
    hasIcon: false,
    managerId: null,
    managerName: null,
    startDate: null,
    targetDate: null,
    notes: "",
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
  };
}

function integration(projectId: string, repoUrl: string): ProjectIntegration {
  return {
    projectId,
    repoUrl,
    hasToken: true,
    syncIssues: false,
    syncStatus: false,
    syncComments: false,
    syncPullRequests: false,
    syncCommits: false,
    syncDirection: "pull",
    syncIntervalMinutes: GITHUB_SYNC_INTERVAL.MANUAL,
    isConnected: true,
    repoName: repoUrl.replace("https://github.com/", ""),
    lastSyncAt: null,
    nextSyncAt: null,
    updatedAt: "2026-01-01 00:00:00",
    syncEnabled: false,
  };
}

/** Whether two registrations are the same directory or one lies inside the other. */
function overlaps(first: string, second: string): boolean {
  return (
    first === second ||
    first.startsWith(`${second}${path.sep}`) ||
    second.startsWith(`${first}${path.sep}`)
  );
}

/**
 * The accounts, projects, registry and operation keys of one test, in memory.
 *
 * @remarks
 * Only the boundaries are replaced: the account snapshot, the project
 * repository, the registry tables, the operation key table and the file
 * system. The registry service, the path rules and the operation service are
 * the production classes, so a test exercises the rules of Pages and not a copy.
 */
export class WorkspaceWorld {
  /** The registry as the interface sees it. */
  public readonly registry: AgentWorkspaceService;
  /** The operations an MCP client calls. */
  public readonly operations: AgentWorkspaceOperationService;
  public readonly keys = new Map<string, StoredAgentOperation>();
  /** How often the registry tables were written, to show that a refusal writes nothing. */
  public readonly writes = { saves: 0, removals: 0 };
  private workspaces: AgentWorkspace[] = [];
  private readonly accounts = new Map<string, AccountAccess>();
  private readonly projects = new Map<string, Project>();
  private readonly integrations = new Map<string, ProjectIntegration>();
  private readonly managers = new Set<string>();
  private readonly usages = new Map<string, AgentWorkspaceUsage[]>();
  private sequence = 0;

  public constructor() {
    memoryFilesystem.reset();
    memoryFilesystem.addDirectory(DATA_DIRECTORY);
    memoryFilesystem.addDirectory(AGENTS_DIRECTORY);
    this.registry = new AgentWorkspaceService(this.dependencies("ui"));
    this.operations = new AgentWorkspaceOperationService({
      database: this.database(),
      workspaces: this.registry.forChannel("mcp"),
    });
  }

  /** Adds an active person with the given rights. */
  public addPerson(userId: string, options: PersonOptions = {}): void {
    this.accounts.set(userId, account(userId, options));
  }

  /** Replaces the account of a person, as an administrator changing a role does. */
  public changePerson(userId: string, options: PersonOptions): void {
    this.addPerson(userId, options);
  }

  /** Adds a project, linked to a GitHub repository unless told otherwise. */
  public addProject(id: string, options: ProjectOptions = {}): void {
    this.projects.set(id, project(id, options));
    const github =
      options.github === undefined
        ? `https://github.com/example/${id}`
        : options.github;
    if (github !== null) this.integrations.set(id, integration(id, github));
  }

  /** Makes the person a manager of the project. */
  public addManager(projectId: string, userId: string): void {
    this.managers.add(`${projectId}:${userId}`);
  }

  /** Ends the management of the project for the person. */
  public removeManager(projectId: string, userId: string): void {
    this.managers.delete(`${projectId}:${userId}`);
  }

  /** Removes the project itself, which leaves its registrations behind. */
  public removeProject(id: string): void {
    this.projects.delete(id);
    this.integrations.delete(id);
  }

  /** Lets a plan refer to the workspace, which blocks changing or removing it. */
  public addUsage(workspaceId: string): void {
    this.usages.set(workspaceId, [
      { id: "plan-1", name: "Plan", kind: "plan" },
    ]);
  }

  /** Creates an existing directory in the file system, without registering it. */
  public directory(location: string): string {
    memoryFilesystem.addDirectory(location);
    return location;
  }

  /** Creates the directory in the file system and registers it, bypassing every rule. */
  public seed(input: SeededWorkspace): string {
    memoryFilesystem.addDirectory(input.path);
    this.sequence += 1;
    const id = `workspace-${this.sequence}`;
    this.workspaces.push({
      id,
      name: input.name ?? `Workspace ${this.sequence}`,
      path: input.path,
      projectId: input.projectId,
      directoryIdentity: memoryFilesystem.identityOf(input.path),
      registeredBy: "seed",
      revision: 1,
    });
    return id;
  }

  /** The registrations as they are stored now. */
  public stored(): readonly AgentWorkspace[] {
    return this.workspaces;
  }

  /** The GitHub links of all projects, to compare before and after a call. */
  public links(): readonly string[] {
    return [...this.integrations.values()].map(
      (entry) => `${entry.projectId}=${entry.repoUrl}`,
    );
  }

  /** The identity a verified MCP credential of the person resolves to. */
  public identity(userId: string): AgentIdentity {
    return {
      userId,
      isAdmin: this.accounts.get(userId)?.isAdmin ?? false,
      permissions: [],
    };
  }

  /** Calls an operation as the person and returns the result of its response. */
  public async call(
    userId: string,
    operation: string,
    parameters: unknown = {},
  ): Promise<unknown> {
    const response = await this.operations.handle(
      this.identity(userId),
      operation,
      parameters,
    );
    if (response === null) throw new Error(`Unhandled operation ${operation}`);
    return response.result;
  }

  private dependencies(channel: "ui" | "mcp"): AgentWorkspaceDependencies {
    return {
      channel,
      workspaces: this.repository(),
      authorization: {
        snapshot: async () => ({
          roles: [],
          departments: [],
          accounts: [...this.accounts.values()],
        }),
      },
      projects: {
        findAll: async () => [...this.projects.values()],
        findById: async (id) => this.projects.get(id) ?? null,
        findIntegration: async (id) => this.integrations.get(id) ?? null,
        findIntegrationsByProjectIds: async (ids) =>
          new Map(
            ids.flatMap((id) => {
              const entry = this.integrations.get(id);
              return entry ? [[id, entry] as const] : [];
            }),
          ),
        findManagedProjectIds: async (userId) =>
          [...this.projects.keys()].filter((id) =>
            this.managers.has(`${id}:${userId}`),
          ),
        isProjectManager: async (projectId, userId) =>
          this.managers.has(`${projectId}:${userId}`),
      },
      paths: new AgentWorkspacePath({
        roots: ["/"],
        startDirectory: "/home/pages",
        protectedDirectory: DATA_DIRECTORY,
        additionalProtectedDirectories: [AGENTS_DIRECTORY],
      }),
    };
  }

  private database(): Pick<Database, "transaction"> {
    const keys = this.keys;
    const transaction: DatabaseTransaction = {
      query: async (statement, parameters = {}) => {
        if (!statement.includes("FROM agent_operation_keys"))
          throw new Error("Unexpected query");
        const stored = keys.get(
          `${parameters.user_id}/${parameters.operation_id}`,
        );
        return stored
          ? [[stored.fingerprint, stored.operation, stored.resultJson]]
          : [];
      },
      execute: async (statement, parameters = {}) => {
        if (!statement.includes("INSERT INTO agent_operation_keys"))
          throw new Error("Unexpected statement");
        const key = `${parameters.user_id}/${parameters.operation_id}`;
        if (keys.has(key)) throw new Error(`Duplicate key "user_id: ${key}"`);
        keys.set(key, {
          operation: String(parameters.operation),
          fingerprint: String(parameters.fingerprint),
          resultJson: String(parameters.result_json),
        });
      },
    };
    return {
      transaction: async (work) => {
        const workspaces = [...this.workspaces];
        const stored = new Map(keys);
        try {
          return await work(transaction);
        } catch (error: unknown) {
          // A failed transaction leaves neither the registration nor its key.
          this.workspaces = workspaces;
          keys.clear();
          stored.forEach((value, key) => keys.set(key, value));
          throw error;
        }
      },
    };
  }

  private repository(): AgentWorkspaceDependencies["workspaces"] {
    const database = this.database();
    return {
      list: async () =>
        [...this.workspaces].sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      usages: async (id) => this.usages.get(id) ?? [],
      save: (workspace, isNew, journal) =>
        database.transaction((transaction) =>
          this.writeRecord(transaction, workspace, isNew, journal),
        ),
      remove: (id, revision, journal) =>
        database.transaction((transaction) =>
          this.removeRecord(transaction, id, revision, journal),
        ),
    };
  }

  private async writeRecord(
    transaction: DatabaseTransaction,
    workspace: AgentWorkspace,
    isNew: boolean,
    journal: WorkspaceJournal | undefined,
  ): Promise<void> {
    const previous = this.workspaces.find((entry) => entry.id === workspace.id);
    if (
      (!isNew && previous?.revision !== workspace.revision) ||
      (isNew && previous)
    )
      throw new AgentError("workspace_conflict");
    this.requireFreeDirectory(workspace);
    this.requireUnusedForRebinding(workspace, previous);
    const saved = { ...workspace, revision: (previous?.revision ?? 0) + 1 };
    this.workspaces = [
      ...this.workspaces.filter((entry) => entry.id !== workspace.id),
      saved,
    ];
    this.writes.saves += 1;
    await journal?.(transaction, saved);
  }

  private requireFreeDirectory(workspace: AgentWorkspace): void {
    if (
      this.workspaces.some(
        (entry) =>
          entry.id !== workspace.id && overlaps(entry.path, workspace.path),
      )
    )
      throw new AgentError("workspace_path_conflict");
  }

  private requireUnusedForRebinding(
    workspace: AgentWorkspace,
    previous: AgentWorkspace | undefined,
  ): void {
    const isRebinding =
      previous !== undefined &&
      (previous.path !== workspace.path ||
        previous.projectId !== workspace.projectId);
    if (isRebinding && (this.usages.get(workspace.id)?.length ?? 0) > 0)
      throw new AgentError("workspace_in_use");
  }

  private async removeRecord(
    transaction: DatabaseTransaction,
    id: string,
    revision: number,
    journal: WorkspaceJournal | undefined,
  ): Promise<void> {
    const previous = this.workspaces.find((entry) => entry.id === id);
    if (!previous) throw new AgentError("workspace_not_found");
    if (previous.revision !== revision)
      throw new AgentError("workspace_conflict");
    if ((this.usages.get(id)?.length ?? 0) > 0)
      throw new AgentError("workspace_in_use");
    this.workspaces = this.workspaces.filter((entry) => entry.id !== id);
    this.writes.removals += 1;
    await journal?.(transaction, previous);
  }
}
