import { vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AgentExtensionService } from "@/backend/service/agents/AgentExtensionService";
import { AgentTicketAnnouncer } from "@/backend/service/agents/AgentTicketAnnouncer";
import { createAgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";

import {
  archiveAccount,
  archiveMilestone,
  archiveProject,
  archiveTicket,
  archiveUser,
} from "./archive-records";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { NewProjectActivity } from "@/backend/database/repositories/ProjectRepository";
import type { NewWorkItemHistory } from "@/backend/database/repositories/TaskRepository";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { AgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { AccountAccess } from "@/definition/Authorization";
import type { Language } from "@/language/Language";
import type {
  Milestone,
  MilestoneDependency,
  WorkItemDetail,
  WorkItemVisibility,
} from "@/definition/Task";
import type { Project } from "@/definition/Project";
import type { User } from "@/definition/User";
import type { ArchivePersonOptions } from "./archive-records";

/** The two operations exposed under the compatible delete tool names. */
export type ArchiveOperation = "ticket.delete" | "milestone.delete";

function isVisible(item: WorkItemDetail, scope?: WorkItemVisibility): boolean {
  const hasDepartment =
    !scope ||
    scope.departmentIds === null ||
    item.departmentId === null ||
    scope.departmentIds.includes(item.departmentId);
  return (
    hasDepartment &&
    (!scope?.projectIds || scope.projectIds.includes(item.projectId))
  );
}

/**
 * Synthetic repository boundaries around the real archive and transaction services.
 * No database, network, service factory or MCP executable is opened.
 */
export class ArchiveWorld {
  public readonly accounts = new Map<string, AccountAccess>();
  public readonly users = new Map<string, User>();
  public readonly projects = new Map<string, Project>();
  public readonly tickets = new Map<string, WorkItemDetail>();
  public readonly milestones = new Map<string, Milestone>();
  public readonly managers = new Set<string>();
  public readonly languages = new Map<string, Language>();
  public readonly keys = new Map<string, StoredAgentOperation>();
  public readonly history: NewWorkItemHistory[] = [];
  public readonly activity: NewProjectActivity[] = [];
  public readonly events: PagesEvent[] = [];
  public dependencies: MilestoneDependency[] = [];
  public readonly writes = { tickets: 0, milestones: 0, dependencies: 0 };
  public readonly operations: AgentExtensionService;
  private readonly connection: DatabaseTransaction = {
    query: vi.fn(async () => {
      throw new Error("Unexpected database query");
    }),
    execute: vi.fn(async () => {
      throw new Error("Unexpected database write");
    }),
  };

  public constructor() {
    this.mockAuthorization();
    this.mockTickets();
    this.mockMilestones();
    this.mockKeys();
    const cache = ServerCache.disabled();
    const events = new PagesEventPublisher();
    events.subscribe((event) => this.events.push(event));
    this.operations = new AgentExtensionService({
      database: this.database(),
      cache,
      planning: {
        readProjectTickets: async () => {
          throw new Error("Unexpected planning read");
        },
      },
      announcer: new AgentTicketAnnouncer({ cache, events, publisher: null }),
    });
    this.addPerson("admin", { isAdmin: true, capabilities: [] });
    this.addPerson("manager");
    this.addPerson("writer", { capabilities: ["write"] });
    this.addPerson("reader", { capabilities: [] });
    this.addProject("engineering", ["engineering"]);
    this.addProject("design", ["design"]);
    this.managers.add("engineering:manager");
    this.managers.add("engineering:writer");
    this.addTicket("root");
    this.milestones.set(
      "milestone",
      archiveMilestone("milestone", "engineering"),
    );
  }

  /** Replaces persisted account facts without granting rights through the presented identity. */
  public addPerson(id: string, options: ArchivePersonOptions = {}): void {
    this.accounts.set(id, archiveAccount(id, options));
    this.users.set(id, archiveUser(id, options));
  }

  /** Adds or reassigns a project's departments. */
  public addProject(id: string, departments: readonly string[]): void {
    this.projects.set(id, archiveProject(id, departments));
  }

  /** Adds a synthetic ticket with explicit hierarchy and visibility overrides. */
  public addTicket(id: string, overrides: Partial<WorkItemDetail> = {}): void {
    this.tickets.set(id, archiveTicket(id, overrides));
  }

  /** Builds the unchanged public parameters, with a fresh id by default. */
  public request(
    operation: ArchiveOperation,
    operationId = "archive-once",
  ): Readonly<Record<string, unknown>> {
    return {
      operationId,
      ...(operation === "ticket.delete"
        ? { ticketId: "root" }
        : { projectId: "engineering", milestoneId: "milestone" }),
      confirmation: "LÖSCHEN",
    };
  }

  /** Runs the production dispatcher with identity hints deliberately carrying no permissions. */
  public async call(
    userId: string,
    operation: ArchiveOperation,
    parameters = this.request(operation),
  ): Promise<unknown> {
    const response = await this.operations.handle(
      { userId, isAdmin: false, permissions: [] },
      operation,
      parameters,
    );
    if (response === null) throw new Error("Unhandled archive operation");
    return response.result;
  }

  /** Uses the UI channel with the same production TaskService and policy decisions. */
  public ui(userId: string): AgentTaskContext {
    const actor = this.users.get(userId);
    if (!actor) throw new Error("Unknown synthetic user");
    return createAgentTaskContext(
      { ...this.connection, ...this.database() },
      actor,
      "chat",
    );
  }

  /** Counts the observable writes and notifications, excluding initial synthetic records. */
  public changes(): unknown {
    return {
      ...this.writes,
      history: this.history.length,
      activity: this.activity.length,
      events: this.events.length,
      keys: this.keys.size,
    };
  }

  private database(): Pick<Database, "transaction"> {
    return {
      transaction: async <Result>(
        work: (transaction: DatabaseTransaction) => Promise<Result>,
      ): Promise<Result> => {
        const tickets = new Map(this.tickets);
        const milestones = new Map(this.milestones);
        const keys = new Map(this.keys);
        const dependencies = [...this.dependencies];
        const counts = { ...this.writes };
        const historyLength = this.history.length;
        const activityLength = this.activity.length;
        try {
          return await work(this.connection);
        } catch (error: unknown) {
          this.tickets.clear();
          tickets.forEach((ticket, id) => this.tickets.set(id, ticket));
          this.milestones.clear();
          milestones.forEach((milestone, id) =>
            this.milestones.set(id, milestone),
          );
          this.keys.clear();
          keys.forEach((stored, id) => this.keys.set(id, stored));
          this.dependencies = dependencies;
          Object.assign(this.writes, counts);
          this.history.length = historyLength;
          this.activity.length = activityLength;
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
    vi.spyOn(ProjectRepository.prototype, "findById").mockImplementation(
      async (id) => this.projects.get(id) ?? null,
    );
    vi.spyOn(ProjectRepository.prototype, "findAll").mockImplementation(
      async () => [...this.projects.values()],
    );
    vi.spyOn(ProjectRepository.prototype, "findActiveIds").mockImplementation(
      async () => [...this.projects.keys()],
    );
    vi.spyOn(
      ProjectRepository.prototype,
      "findDepartmentsByProjects",
    ).mockImplementation(
      async (ids) =>
        new Map(
          ids.map((id) => [
            id,
            [...(this.projects.get(id)?.departments ?? [])],
          ]),
        ),
    );
    vi.spyOn(
      ProjectRepository.prototype,
      "isProjectManager",
    ).mockImplementation(async (projectId, userId) =>
      this.managers.has(`${projectId}:${userId}`),
    );
    vi.spyOn(ProjectRepository.prototype, "insertActivity").mockImplementation(
      async (entry) => {
        this.activity.push(entry);
      },
    );
    vi.spyOn(
      UserSettingsRepository.prototype,
      "findByUserId",
    ).mockImplementation(async (id) => ({
      language: this.languages.get(id) ?? "de",
      theme: null,
      timezone: null,
      dateFormat: null,
      weekStart: null,
      notifyEmail: null,
      notifyDesktop: null,
      notifyMentions: null,
      notifyAssignments: null,
      notifyDueDates: null,
      notifyWeeklySummary: null,
    }));
  }

  private subtree(rootId: string): WorkItemDetail[] {
    const ids = new Set([rootId]);
    let previousSize = 0;
    while (previousSize !== ids.size) {
      previousSize = ids.size;
      for (const ticket of this.tickets.values()) {
        if (ticket.parentId !== null && ids.has(ticket.parentId))
          ids.add(ticket.id);
      }
    }
    return [...this.tickets.values()].filter((ticket) => ids.has(ticket.id));
  }

  private mockTickets(): void {
    vi.spyOn(TaskRepository.prototype, "findById").mockImplementation(
      async (id, scope) => {
        const ticket = this.tickets.get(id);
        return ticket && isVisible(ticket, scope) ? ticket : null;
      },
    );
    vi.spyOn(TaskRepository.prototype, "findByKey").mockImplementation(
      async (key, scope) =>
        [...this.tickets.values()].find(
          (ticket) => ticket.key === key && isVisible(ticket, scope),
        ) ?? null,
    );
    vi.spyOn(TaskRepository.prototype, "findSubtreeIds").mockImplementation(
      async (id, scope) =>
        this.subtree(id)
          .filter((ticket) => isVisible(ticket, scope))
          .map((ticket) => ticket.id),
    );
    vi.spyOn(TaskRepository.prototype, "archiveMany").mockImplementation(
      async (ids) => {
        const changed = [...this.tickets.values()].filter(
          (ticket) => ids.includes(ticket.id) && ticket.archivedAt === null,
        );
        for (const ticket of changed)
          this.tickets.set(ticket.id, {
            ...ticket,
            archivedAt: "2026-10-14 00:00:00",
          });
        this.writes.tickets += changed.length;
        return changed.map((ticket) => ticket.id);
      },
    );
    vi.spyOn(TaskRepository.prototype, "insertHistory").mockImplementation(
      async (entry) => {
        this.history.push(entry);
      },
    );
  }

  private mockMilestones(): void {
    vi.spyOn(TaskRepository.prototype, "findMilestoneById").mockImplementation(
      async (id, options) => {
        const milestone = this.milestones.get(id);
        return milestone &&
          (options?.includeArchived || milestone.archivedAt === null)
          ? milestone
          : null;
      },
    );
    vi.spyOn(
      TaskRepository.prototype,
      "findMilestonesByProjectIds",
    ).mockImplementation(async (ids) =>
      [...this.milestones.values()].filter(
        (milestone) =>
          ids.includes(milestone.projectId) && milestone.archivedAt === null,
      ),
    );
    vi.spyOn(TaskRepository.prototype, "archiveMilestone").mockImplementation(
      async (id) => {
        const milestone = this.milestones.get(id);
        if (!milestone) throw new Error("Missing synthetic milestone");
        this.milestones.set(id, {
          ...milestone,
          archivedAt: "2026-10-14 00:00:00",
        });
        this.writes.milestones += 1;
      },
    );
    vi.spyOn(
      TaskRepository.prototype,
      "deleteDependenciesByMilestone",
    ).mockImplementation(async (id) => {
      this.dependencies = this.dependencies.filter(
        (dependency) =>
          dependency.sourceId !== id && dependency.targetId !== id,
      );
      this.writes.dependencies += 1;
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
}
