import { vi } from "vitest";

import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { ProjectService } from "@/backend/service/ProjectService";

import {
  archiveAccount,
  archiveProject,
  archiveUser,
} from "../agents/archive-records";

import type { Database } from "@/backend/database/Database";
import type {
  NewProject,
  NewProjectActivity,
  NewProjectGoal,
} from "@/backend/database/repositories/ProjectRepository";
import type { NewProjectIntegration } from "@/backend/database/repositories/project/ProjectIntegrationRepository";
import type { ProjectIcon } from "@/backend/database/repositories/project/ProjectIconRepository";
import type { AccountAccess, Department } from "@/definition/Authorization";
import type {
  ArchivedProject,
  Project,
  ProjectEvent,
  ProjectGoal,
  ProjectIntegration,
  ProjectMember,
  ProjectTemplate,
} from "@/definition/Project";
import type { User } from "@/definition/User";
import type { ArchivePersonOptions } from "../agents/archive-records";

/** Everything the synthetic project persistence holds; copied for rollback. */
export interface ProjectState {
  accounts: Map<string, AccountAccess>;
  departments: Department[];
  projects: Map<string, Project>;
  archived: Map<string, ArchivedProject>;
  managers: Set<string>;
  members: Map<string, ProjectMember[]>;
  goals: Map<string, ProjectGoal[]>;
  tags: Map<string, string[]>;
  events: Map<string, ProjectEvent[]>;
  integrations: Map<string, ProjectIntegration>;
  secrets: Map<string, NewProjectIntegration>;
  templates: ProjectTemplate[];
  icons: Map<string, ProjectIcon>;
  departmentWrites: Map<string, string[]>;
  inserted: NewProject[];
  activity: NewProjectActivity[];
}

/** Fixed clock text of every synthetic record. */
export const WORLD_TIME = "2026-01-01 00:00:00";

function emptyState(): ProjectState {
  return {
    accounts: new Map(),
    departments: [
      { id: "engineering", name: "Engineering" },
      { id: "design", name: "Design" },
    ],
    projects: new Map(),
    archived: new Map(),
    managers: new Set(),
    members: new Map(),
    goals: new Map(),
    tags: new Map(),
    events: new Map(),
    integrations: new Map(),
    secrets: new Map(),
    templates: [],
    icons: new Map(),
    departmentWrites: new Map(),
    inserted: [],
    activity: [],
  };
}

function unexpectedDatabase(): Pick<
  Database,
  "execute" | "query" | "transaction"
> {
  return {
    query: vi.fn(async () => {
      throw new Error("Unexpected database query");
    }),
    execute: vi.fn(async () => {
      throw new Error("Unexpected database write");
    }),
    transaction: vi.fn(async () => {
      throw new Error("Unexpected database transaction");
    }),
  };
}

/** Options of the synthetic world. */
export interface ProjectWorldOptions {
  /** Key encrypting GitHub tokens; `null` leaves the server unconfigured. */
  readonly tokenKey?: Buffer | null;
  /** Server cache; disabled unless a test exercises caching. */
  readonly cache?: ServerCache;
}

/**
 * Synthetic project persistence behind the real project services.
 *
 * @remarks
 * Repository methods are replaced on the prototype by in-memory behavior;
 * every other repository method fails loudly. Transactions copy the state and
 * restore it when the work throws, so a refused change is seen as unchanged.
 */
export class ProjectWorld {
  public state: ProjectState = emptyState();
  /** Names of the repository write methods that ran, in order. */
  public writes: string[] = [];
  public readonly cache: ServerCache;
  public readonly repository: ProjectRepository;
  public readonly permissions: PermissionService;
  public readonly service: ProjectService;
  private readonly users = new Map<string, User>();

  public constructor(options: ProjectWorldOptions = {}) {
    this.cache = options.cache ?? ServerCache.disabled();
    this.repository = new ProjectRepository(unexpectedDatabase());
    this.permissions = new PermissionService(async (userId) => {
      const account = this.state.accounts.get(userId);
      if (!account) throw new Error(`Unknown synthetic account ${userId}`);
      return account;
    });
    this.mockTransaction();
    this.mockAuthorization();
    this.mockProjects();
    this.mockLifecycle();
    this.mockTeam();
    this.mockPlanning();
    this.mockIntegrations();
    this.mockTemplates();
    this.service = new ProjectService(
      this.repository,
      this.permissions,
      options.tokenKey === undefined ? Buffer.alloc(32, 7) : options.tokenKey,
      this.cache,
    );
    this.addPerson("admin", { isAdmin: true, mode: "admin", capabilities: [] });
    this.addPerson("lead", {
      capabilities: ["write", "manage_projects", "archive_projects"],
      managedDepartments: ["engineering"],
    });
    this.addPerson("writer", { capabilities: ["write"] });
    this.addPerson("outsider", {
      capabilities: ["write"],
      departments: ["design"],
    });
    this.addProject("alpha", ["engineering"]);
  }

  /** Replaces persisted account facts and the matching user row. */
  public addPerson(id: string, options: ArchivePersonOptions = {}): void {
    this.state.accounts.set(id, archiveAccount(id, options));
    this.users.set(id, archiveUser(id, options));
  }

  /** The user row an actor presents; it never grants rights on its own. */
  public user(id: string): User {
    const user = this.users.get(id);
    if (!user) throw new Error(`Unknown synthetic user ${id}`);
    return user;
  }

  /** Adds an active project with its departments and its first member. */
  public addProject(id: string, departmentIds: readonly string[]): void {
    this.state.projects.set(id, archiveProject(id, departmentIds));
    this.state.members.set(id, [member("writer")]);
  }

  /** Moves a project into the archive. */
  public archive(id: string): void {
    const project = this.state.projects.get(id);
    if (!project) throw new Error(`Unknown synthetic project ${id}`);
    this.state.projects.delete(id);
    this.state.archived.set(id, { ...project, archivedAt: WORLD_TIME });
  }

  /** Makes a person the responsible manager of a project. */
  public manage(projectId: string, userId: string): void {
    this.state.managers.add(`${projectId}:${userId}`);
  }

  /** A project exactly as persisted. */
  public project(id: string): Project {
    const project = this.state.projects.get(id);
    if (!project) throw new Error(`Unknown synthetic project ${id}`);
    return project;
  }

  private record(name: string): void {
    this.writes.push(name);
  }

  private mockTransaction(): void {
    vi.spyOn(ProjectRepository.prototype, "transaction").mockImplementation(
      async (work) => {
        const before = structuredClone(this.state);
        const writesBefore = this.writes.length;
        try {
          return await work(this.repository);
        } catch (error: unknown) {
          this.state = before;
          this.writes.length = writesBefore;
          throw error;
        }
      },
    );
  }

  private mockAuthorization(): void {
    vi.spyOn(AuthorizationRepository.prototype, "snapshot").mockImplementation(
      async () => ({
        accounts: [...this.state.accounts.values()],
        roles: [],
        departments: this.state.departments,
      }),
    );
  }

  private mockProjects(): void {
    const proto = ProjectRepository.prototype;
    vi.spyOn(proto, "findAll").mockImplementation(async () => [
      ...this.state.projects.values(),
    ]);
    vi.spyOn(proto, "findActiveIds").mockImplementation(async () => [
      ...this.state.projects.keys(),
    ]);
    vi.spyOn(proto, "findById").mockImplementation(
      async (id) => this.state.projects.get(id) ?? null,
    );
    vi.spyOn(proto, "findArchivedById").mockImplementation(
      async (id) => this.state.archived.get(id) ?? null,
    );
    vi.spyOn(proto, "findArchived").mockImplementation(async () => [
      ...this.state.archived.values(),
    ]);
    vi.spyOn(proto, "findDepartmentsByProjects").mockImplementation(
      async (ids) =>
        new Map(
          ids.map((id) => [
            id,
            [...(this.state.projects.get(id)?.departments ?? [])],
          ]),
        ),
    );
    vi.spyOn(proto, "isProjectManager").mockImplementation(
      async (projectId, userId) =>
        this.state.managers.has(`${projectId}:${userId}`),
    );
    vi.spyOn(proto, "insertActivity").mockImplementation(async (entry) => {
      this.record("insertActivity");
      this.state.activity.push(entry);
    });
    vi.spyOn(proto, "findActivity").mockImplementation(async () => []);
  }

  private mockLifecycle(): void {
    const proto = ProjectRepository.prototype;
    vi.spyOn(proto, "insert").mockImplementation(async (input) => {
      this.record("insert");
      this.state.inserted.push(input);
      const base = archiveProject(input.id, input.departmentIds ?? []);
      this.state.projects.set(input.id, {
        ...base,
        name: input.name,
        description: input.description,
        status: input.status,
      });
    });
    vi.spyOn(proto, "update").mockImplementation(async (id, update) => {
      this.record("update");
      this.state.projects.set(id, { ...this.project(id), ...update });
    });
    vi.spyOn(proto, "updateDetails").mockImplementation(async (id, update) => {
      this.record("updateDetails");
      this.state.projects.set(id, { ...this.project(id), ...update });
    });
    vi.spyOn(proto, "setDepartments").mockImplementation(async (id, ids) => {
      this.record("setDepartments");
      this.state.departmentWrites.set(id, [...ids]);
      this.state.projects.set(id, {
        ...this.project(id),
        departments: ids.map((departmentId) => ({
          id: departmentId,
          name: departmentId,
        })),
      });
    });
    vi.spyOn(proto, "archive").mockImplementation(async (id) => {
      this.record("archive");
      this.archive(id);
    });
    vi.spyOn(proto, "upsertIcon").mockImplementation(async (id, icon) => {
      this.record("upsertIcon");
      this.state.icons.set(id, icon);
    });
    vi.spyOn(proto, "findIconByProjectId").mockImplementation(
      async (id) => this.state.icons.get(id) ?? null,
    );
  }

  private mockTeam(): void {
    const proto = ProjectRepository.prototype;
    vi.spyOn(proto, "findMembers").mockImplementation(
      async (id) => this.state.members.get(id) ?? [],
    );
    vi.spyOn(proto, "addMember").mockImplementation(
      async (projectId, userId, role) => {
        this.record("addMember");
        const members = this.state.members.get(projectId) ?? [];
        this.state.members.set(projectId, [
          ...members,
          { ...member(userId), projectRole: role },
        ]);
      },
    );
    vi.spyOn(proto, "updateMemberRole").mockImplementation(
      async (projectId, userId, role) => {
        this.record("updateMemberRole");
        const members = this.state.members.get(projectId) ?? [];
        this.state.members.set(
          projectId,
          members.map((entry) =>
            entry.userId === userId ? { ...entry, projectRole: role } : entry,
          ),
        );
      },
    );
    vi.spyOn(proto, "removeMember").mockImplementation(
      async (projectId, userId) => {
        this.record("removeMember");
        const members = this.state.members.get(projectId) ?? [];
        this.state.members.set(
          projectId,
          members.filter((entry) => entry.userId !== userId),
        );
      },
    );
  }

  private mockPlanning(): void {
    const proto = ProjectRepository.prototype;
    vi.spyOn(proto, "findGoals").mockImplementation(
      async (id) => this.state.goals.get(id) ?? [],
    );
    vi.spyOn(proto, "insertGoal").mockImplementation(
      async (goal: NewProjectGoal) => {
        this.record("insertGoal");
        const goals = this.state.goals.get(goal.projectId) ?? [];
        this.state.goals.set(goal.projectId, [
          ...goals,
          { ...goal, isDone: false },
        ]);
      },
    );
    vi.spyOn(proto, "updateGoal").mockImplementation(
      async (id, title, isDone) => {
        this.record("updateGoal");
        for (const [projectId, goals] of this.state.goals)
          this.state.goals.set(
            projectId,
            goals.map((goal) =>
              goal.id === id ? { ...goal, title, isDone } : goal,
            ),
          );
      },
    );
    vi.spyOn(proto, "deleteGoal").mockImplementation(async (id) => {
      this.record("deleteGoal");
      for (const [projectId, goals] of this.state.goals)
        this.state.goals.set(
          projectId,
          goals.filter((goal) => goal.id !== id),
        );
    });
    vi.spyOn(proto, "findTags").mockImplementation(
      async (id) => this.state.tags.get(id) ?? [],
    );
    vi.spyOn(proto, "setTags").mockImplementation(async (id, tags) => {
      this.record("setTags");
      this.state.tags.set(id, [...tags]);
    });
    this.mockEvents();
  }

  private mockEvents(): void {
    const proto = ProjectRepository.prototype;
    vi.spyOn(proto, "findEvents").mockImplementation(
      async (id) => this.state.events.get(id) ?? [],
    );
    vi.spyOn(proto, "insertEvent").mockImplementation(async (event) => {
      this.record("insertEvent");
      const events = this.state.events.get(event.projectId) ?? [];
      this.state.events.set(event.projectId, [
        ...events,
        { ...event, createdAt: WORLD_TIME, updatedAt: WORLD_TIME },
      ]);
    });
    vi.spyOn(proto, "updateEvent").mockImplementation(async (id, update) => {
      this.record("updateEvent");
      for (const [projectId, events] of this.state.events)
        this.state.events.set(
          projectId,
          events.map((event) =>
            event.id === id ? { ...event, ...update } : event,
          ),
        );
    });
    vi.spyOn(proto, "archiveEvent").mockImplementation(async (id) => {
      this.record("archiveEvent");
      for (const [projectId, events] of this.state.events)
        this.state.events.set(
          projectId,
          events.filter((event) => event.id !== id),
        );
    });
  }

  private mockIntegrations(): void {
    const proto = ProjectRepository.prototype;
    vi.spyOn(proto, "findIntegration").mockImplementation(
      async (id) => this.state.integrations.get(id) ?? null,
    );
    vi.spyOn(proto, "findIntegrationsByProjectIds").mockImplementation(
      async (ids) =>
        new Map(
          ids.flatMap((id) => {
            const integration = this.state.integrations.get(id);
            return integration ? [[id, integration] as const] : [];
          }),
        ),
    );
    vi.spyOn(proto, "upsertIntegration").mockImplementation(
      async (projectId, input) => {
        this.record("upsertIntegration");
        const previous = this.state.integrations.get(projectId);
        this.state.secrets.set(projectId, input);
        this.state.integrations.set(projectId, {
          projectId,
          repoUrl: input.repoUrl,
          hasToken: input.tokenEncrypted !== null || !!previous?.hasToken,
          syncIssues: input.syncIssues,
          syncStatus: input.syncStatus,
          syncComments: input.syncComments,
          syncPullRequests: input.syncPullRequests,
          syncCommits: input.syncCommits,
          syncDirection: input.syncDirection,
          syncIntervalMinutes: input.syncIntervalMinutes,
          isConnected: input.isConnected,
          repoName: input.repoName,
          lastSyncAt: input.lastSyncAt,
          nextSyncAt: null,
          updatedAt: WORLD_TIME,
          syncEnabled: previous?.syncEnabled ?? true,
        });
      },
    );
    vi.spyOn(proto, "setIntegrationSyncEnabled").mockImplementation(
      async (projectId, isEnabled) => {
        this.record("setIntegrationSyncEnabled");
        const integration = this.state.integrations.get(projectId);
        if (integration)
          this.state.integrations.set(projectId, {
            ...integration,
            syncEnabled: isEnabled,
          });
      },
    );
    vi.spyOn(proto, "deleteIntegration").mockImplementation(async (id) => {
      this.record("deleteIntegration");
      this.state.integrations.delete(id);
      this.state.secrets.delete(id);
    });
  }

  private mockTemplates(): void {
    const proto = ProjectRepository.prototype;
    vi.spyOn(proto, "findTemplates").mockImplementation(async () => [
      ...this.state.templates,
    ]);
    vi.spyOn(proto, "saveTemplate").mockImplementation(async (template) => {
      this.record("saveTemplate");
      this.state.templates = [
        ...this.state.templates.filter((entry) => entry.id !== template.id),
        template,
      ];
    });
  }
}

function member(userId: string): ProjectMember {
  return {
    userId,
    username: userId,
    displayName: userId,
    projectRole: "member",
    joinedAt: WORLD_TIME,
  };
}
