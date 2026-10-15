import { vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { AdministrationActivityRepository } from "@/backend/database/repositories/AdministrationActivityRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AgentProjectDeletionService } from "@/backend/service/agents/AgentProjectDeletionService";
import { PROJECT_DELETION_COUNT_KEYS } from "@/definition/AgentProjectDeletion";

import {
  archiveAccount,
  archiveProject,
  archiveUser,
} from "../agents/archive-records";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { ProjectDeletionDetails } from "@/backend/database/repositories/ProjectRepository";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { ProjectDeletionFiles } from "@/backend/database/repositories/project/ProjectDeletionFiles";
import type { ProjectDeletionEffects } from "@/backend/service/project/ProjectDeletionService";
import type { AgentAdminChanged } from "@/definition/AgentAdministration";
import type { ProjectDeletionScope } from "@/definition/AgentProjectDeletion";
import type { AccountAccess } from "@/definition/Authorization";
import type { Project } from "@/definition/Project";
import type { User } from "@/definition/User";
import type { ArchivePersonOptions } from "../agents/archive-records";

/** Everything that belongs to one synthetic project. */
export interface ProjectData {
  readonly tickets: number;
  readonly wikiPages: number;
  readonly memberIds: readonly string[];
  readonly files: ProjectDeletionFiles;
}

/** What outlives a deletion, counted so a test can see it unchanged. */
export interface SharedObjects {
  people: number;
  groups: number;
  departments: number;
  agents: number;
  templates: number;
}

function emptyCounts(): ProjectDeletionScope["counts"] {
  return Object.fromEntries(
    PROJECT_DELETION_COUNT_KEYS.map((key) => [key, 0]),
  ) as ProjectDeletionScope["counts"];
}

/**
 * Synthetic repository boundaries around the real deletion services.
 * No database, network, service factory or MCP executable is opened.
 */
export class ProjectDeletionWorld {
  public readonly accounts = new Map<string, AccountAccess>();
  public readonly users = new Map<string, User>();
  public readonly projects = new Map<string, Project>();
  public readonly archived = new Set<string>();
  public readonly data = new Map<string, ProjectData>();
  public readonly keys = new Map<string, StoredAgentOperation>();
  public readonly audit: Parameters<
    AdministrationActivityRepository["insert"]
  >[0][] = [];
  public readonly shared: SharedObjects = {
    people: 4,
    groups: 2,
    departments: 3,
    agents: 5,
    templates: 6,
  };
  /** Every observable step in order: `stop`, `delete:<id>`, `files`. */
  public readonly steps: string[] = [];
  public readonly cache = ServerCache.disabled();
  public readonly effects = {
    stopRuns: vi.fn(async (projectId: string): Promise<void> => {
      this.steps.push(`stop:${projectId}`);
    }),
    removeFiles: vi.fn(async (): Promise<void> => {
      this.steps.push("files");
    }),
  } satisfies ProjectDeletionEffects;
  /** When set, the deletion removes part of the data and then fails. */
  public failDeletionWith: Error | null = null;
  public readonly service: AgentProjectDeletionService;
  public readonly connection: DatabaseTransaction = {
    query: vi.fn(async () => {
      throw new Error("Unexpected database query");
    }),
    execute: vi.fn(async () => {
      throw new Error("Unexpected database write");
    }),
  };

  public constructor() {
    this.mockAuthorization();
    this.mockProjects();
    this.mockKeys();
    this.service = new AgentProjectDeletionService({
      cache: this.cache,
      database: this.database(),
      effects: this.effects,
    });
    this.addPerson("admin", { isAdmin: true, capabilities: [], mode: "role" });
    this.addPerson("uiadmin", {
      isAdmin: true,
      capabilities: [],
      mode: "admin",
    });
    this.addPerson("manager", {
      capabilities: ["write", "manage_projects", "archive_projects"],
      allProjects: true,
    });
    this.addPerson("writer", { capabilities: ["write"] });
    this.addProject("alpha", ["engineering"], { tickets: 4, wikiPages: 2 });
    this.addProject("beta", ["design"], { tickets: 9, wikiPages: 5 });
  }

  /** Replaces persisted account facts without granting rights through the presented identity. */
  public addPerson(id: string, options: ArchivePersonOptions = {}): void {
    this.accounts.set(id, archiveAccount(id, options));
    this.users.set(id, archiveUser(id, options));
  }

  /** Adds a project with its departments and the data that belongs to it. */
  public addProject(
    id: string,
    departments: readonly string[],
    overrides: Partial<ProjectData> = {},
  ): void {
    this.projects.set(id, archiveProject(id, departments));
    this.data.set(id, {
      tickets: overrides.tickets ?? 1,
      wikiPages: overrides.wikiPages ?? 1,
      memberIds: overrides.memberIds ?? ["writer"],
      files: overrides.files ?? {
        agentRunRecords: [{ agentId: "agent-1", runId: `${id}-run` }],
        ticketAttachments: [`${id}-ticket-file`],
        wikiAttachments: [`${id}-wiki-file`],
      },
    });
  }

  /** Moves a project into the archive; it still exists and can be deleted. */
  public archive(id: string): void {
    this.archived.add(id);
  }

  /** The parameters of a confirmed deletion of the first project. */
  public request(
    overrides: Readonly<Record<string, unknown>> = {},
  ): Readonly<Record<string, unknown>> {
    return {
      operationId: "delete-once",
      projectId: "alpha",
      confirmation: "LÖSCHEN",
      ...overrides,
    };
  }

  /** Calls the production service with an identity that deliberately carries no permissions. */
  public async delete(
    userId: string,
    parameters: Readonly<Record<string, unknown>> = this.request(),
  ): Promise<AgentAdminChanged> {
    const response = await this.service.handle(
      { userId, isAdmin: false, permissions: [] },
      "admin.projects.delete",
      parameters,
    );
    if (response === null) throw new Error("Unhandled operation");
    return response.result as AgentAdminChanged;
  }

  /** Reads the extent of a deletion. */
  public async scope(
    userId: string,
    parameters: Readonly<Record<string, unknown>> = { projectId: "alpha" },
  ): Promise<ProjectDeletionScope> {
    const response = await this.service.handle(
      { userId, isAdmin: false, permissions: [] },
      "admin.projects.deletionScope",
      parameters,
    );
    if (response === null) throw new Error("Unhandled operation");
    return response.result as ProjectDeletionScope;
  }

  /** The state a test compares to prove that a refused call changed nothing. */
  public changes(): unknown {
    return {
      projects: [...this.projects.keys()].sort(),
      data: [...this.data.entries()],
      shared: { ...this.shared },
      keys: this.keys.size,
      audit: this.audit.length,
      steps: [...this.steps],
    };
  }

  /** The persisted database the services run on, with rollback of this world on failure. */
  public database(): Pick<Database, "transaction"> {
    return {
      transaction: async <Result>(
        work: (transaction: DatabaseTransaction) => Promise<Result>,
      ): Promise<Result> => {
        const projects = new Map(this.projects);
        const projectData = new Map(this.data);
        const keys = new Map(this.keys);
        const auditLength = this.audit.length;
        try {
          return await work(this.connection);
        } catch (error: unknown) {
          this.projects.clear();
          projects.forEach((project, id) => this.projects.set(id, project));
          this.data.clear();
          projectData.forEach((entry, id) => this.data.set(id, entry));
          this.keys.clear();
          keys.forEach((stored, id) => this.keys.set(id, stored));
          this.audit.length = auditLength;
          throw error;
        }
      },
    };
  }

  private mockAuthorization(): void {
    vi.spyOn(UserRepository.prototype, "findById").mockImplementation(
      async (id) => this.users.get(id) ?? null,
    );
    vi.spyOn(AuthorizationRepository.prototype, "snapshot").mockImplementation(
      async () => ({
        accounts: [...this.accounts.values()],
        roles: [],
        departments: [],
      }),
    );
    vi.spyOn(
      AdministrationActivityRepository.prototype,
      "insert",
    ).mockImplementation(async (entry) => {
      this.audit.push(entry);
    });
  }

  private mockProjects(): void {
    vi.spyOn(ProjectRepository.prototype, "findById").mockImplementation(
      async (id) =>
        this.archived.has(id) ? null : (this.projects.get(id) ?? null),
    );
    vi.spyOn(
      ProjectRepository.prototype,
      "findArchivedById",
    ).mockImplementation(async (id) => {
      const project = this.projects.get(id);
      return project && this.archived.has(id)
        ? { ...project, archivedAt: "2026-01-01 00:00:00" }
        : null;
    });
    vi.spyOn(
      ProjectRepository.prototype,
      "describeDeletion",
    ).mockImplementation(async (id) => this.describe(id));
    vi.spyOn(
      ProjectRepository.prototype,
      "deletePermanently",
    ).mockImplementation(async (id) => {
      const removed = this.data.get(id);
      this.steps.push(`delete:${id}`);
      this.projects.delete(id);
      this.data.delete(id);
      if (this.failDeletionWith) throw this.failDeletionWith;
      return removed?.files ?? EMPTY_FILES;
    });
  }

  private mockKeys(): void {
    vi.spyOn(AgentOperationKeyRepository.prototype, "find").mockImplementation(
      async (userId, operationId) =>
        this.keys.get(`${userId}:${operationId}`) ?? null,
    );
    vi.spyOn(
      AgentOperationKeyRepository.prototype,
      "insert",
    ).mockImplementation(async (userId, operationId, stored) => {
      this.keys.set(`${userId}:${operationId}`, stored);
    });
  }

  private describe(id: string): ProjectDeletionDetails | null {
    const project = this.projects.get(id);
    const projectData = this.data.get(id);
    if (!project || !projectData) return null;
    return {
      memberIds: projectData.memberIds,
      scope: {
        project: {
          id,
          name: project.name,
          status: project.status,
          isArchived: this.archived.has(id),
          departmentNames: project.departments.map(({ name }) => name),
        },
        counts: {
          ...emptyCounts(),
          tickets: projectData.tickets,
          wikiPages: projectData.wikiPages,
          members: projectData.memberIds.length,
        },
        detached: {
          templateAssignments: 1,
          wikiAnchors: 0,
          wikiLinks: 2,
          boardPreferences: 0,
        },
      },
    };
  }
}

const EMPTY_FILES: ProjectDeletionFiles = {
  agentRunRecords: [],
  ticketAttachments: [],
  wikiAttachments: [],
};
