import { vi } from "vitest";

import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { AgentTicketAnnouncer } from "@/backend/service/agents/AgentTicketAnnouncer";
import { AgentTicketChecklistService } from "@/backend/service/agents/AgentTicketChecklistService";
import { AgentTicketTransaction } from "@/backend/service/agents/AgentTicketTransaction";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { CAPABILITY } from "@/definition/Authorization";

import {
  archiveAccount,
  archiveProject,
  archiveTicket,
  archiveUser,
} from "./archive-records";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";
import type { NewWorkItemHistory } from "@/backend/database/repositories/TaskRepository";
import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { AgentPlanningServices } from "@/backend/service/agents/AgentPlanningServices";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { AccountAccess, Capability } from "@/definition/Authorization";
import type {
  AgentChecklistItemsChanged,
  AgentTicketChecklist,
} from "@/definition/AgentTicketChecklist";
import type { Project } from "@/definition/Project";
import type { WorkItemChecklistItem, WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

/** Stands in for a dependency the tested path never reaches. */
const UNUSED: unknown = Object.create(null);

/** The synthetic ticket every call of this world addresses. */
export const CHECKLIST_TICKET_ID = "ticket-75";
export const CHECKLIST_TICKET_KEY = "SYN-75";

/**
 * Task list items with a nested pair and a code block, and a trailing newline
 * that a trimming write would remove.
 */
export const CHECKLIST_DESCRIPTION = [
  "## Plan",
  "",
  "- [ ] Parent task",
  "  - [ ] Nested task",
  "  - [x] Done nested task",
  "- [ ] Second task",
  "",
  "```",
  "- [ ] Not a task, it is code",
  "```",
  "",
  "Closing paragraph.",
  "",
].join("\n");

function criterion(
  id: string,
  title: string,
  isDone: boolean,
  sortOrder: number,
): WorkItemChecklistItem {
  return {
    id,
    workItemId: CHECKLIST_TICKET_ID,
    title,
    isDone,
    sortOrder,
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
  };
}

/** Counts of what the mocked storage has written, to show what a call left alone. */
export interface StorageWrites {
  criteria: number;
  descriptions: number;
}

interface StoredRevision {
  readonly revision: number;
  readonly contentHash: string;
}

/** Narrows an operation result to the checklist envelope of `ticket.checklist.read`. */
export function isChecklist(result: unknown): result is AgentTicketChecklist {
  return (
    typeof result === "object" &&
    result !== null &&
    "items" in result &&
    Array.isArray(result.items) &&
    "revision" in result &&
    typeof result.revision === "string"
  );
}

/** Narrows an operation result to the complete checklist a bulk change returns. */
export function isBulkResult(
  result: unknown,
): result is AgentChecklistItemsChanged {
  return (
    isChecklist(result) &&
    "changedCount" in result &&
    typeof result.changedCount === "number"
  );
}

/**
 * Synthetic data store around the real checklist service and its transaction.
 *
 * @remarks
 * The ticket, its acceptance criteria, the revision table, the operation
 * keys and the account facts are held in memory by spying on the repository
 * boundaries. The rollback of a failed transaction is simulated by restoring
 * a snapshot. No database, network or MCP process is opened.
 */
export class ChecklistWorld {
  public ticket: WorkItemDetail = archiveTicket(CHECKLIST_TICKET_ID, {
    key: CHECKLIST_TICKET_KEY,
    description: CHECKLIST_DESCRIPTION,
  });
  public criteria: WorkItemChecklistItem[] = [
    criterion("crit-a", "Criterion A", false, 0),
    criterion("crit-b", "Criterion B", true, 1),
  ];
  public readonly events: PagesEvent[] = [];
  public readonly writes: StorageWrites = { criteria: 0, descriptions: 0 };
  /** Makes the next description write fail after the criteria were written. */
  public isDescriptionWriteFailing = false;
  public readonly router: AgentOperationRouter;
  private readonly accounts = new Map<string, AccountAccess>();
  private readonly users = new Map<string, User>();
  private readonly projects = new Map<string, Project>();
  private readonly keys = new Map<string, StoredAgentOperation>();
  private readonly history: NewWorkItemHistory[] = [];
  private revisions = new Map<string, StoredRevision>();
  private readonly connection: DatabaseTransaction = {
    query: vi.fn(async (statement: string, parameters?: SqlParameters) =>
      this.queryRevisions(statement, parameters),
    ),
    execute: vi.fn(async (statement: string, parameters?: SqlParameters) =>
      this.executeRevisions(statement, parameters),
    ),
  };

  public constructor() {
    this.mockAuthorization();
    this.mockTickets();
    this.mockKeys();
    const cache = ServerCache.disabled();
    const events = new PagesEventPublisher();
    events.subscribe((event) => this.events.push(event));
    const database = this.database();
    const service = new AgentTicketChecklistService({
      database,
      users: { getById: async (id) => this.users.get(id) ?? null },
      transaction: new AgentTicketTransaction(database),
      announcer: new AgentTicketAnnouncer({ cache, events, publisher: null }),
    });
    this.router = new AgentOperationRouter({
      projects: UNUSED as ProjectRepository,
      wiki: UNUSED as WikiRepository,
      users: { getById: async () => null },
      planning: Object.assign(UNUSED as AgentPlanningServices, {
        checklists: service,
      }),
    });
    this.addPerson("writer", [CAPABILITY.WRITE]);
    this.addPerson("reader", []);
    this.projects.set(
      "engineering",
      archiveProject("engineering", ["engineering"]),
    );
  }

  /** Adds an account whose rights come from the persisted facts, not from the presented identity. */
  public addPerson(id: string, capabilities: readonly Capability[]): void {
    this.accounts.set(id, archiveAccount(id, { capabilities }));
    this.users.set(id, archiveUser(id, {}));
  }

  /** Runs one operation through the production dispatcher with an identity that carries no permissions. */
  public async call(
    userId: string,
    operation: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const response = await this.router.handle(
      { userId, isAdmin: false, permissions: [] },
      { operation, parameters },
    );
    return response.result;
  }

  /** Reads the checklist of the synthetic ticket as `ticket.checklist.read` returns it. */
  public async read(userId = "writer"): Promise<AgentTicketChecklist> {
    const result = await this.call(userId, "ticket.checklist.read", {
      ticketId: CHECKLIST_TICKET_KEY,
    });
    if (!isChecklist(result)) throw new Error("Unexpected checklist result");
    return result;
  }

  /** Everything a refused call must leave untouched. */
  public stored(): unknown {
    return {
      ticket: this.ticket,
      criteria: this.criteria,
      writes: { ...this.writes },
      history: this.history.length,
      events: this.events.length,
      keys: this.keys.size,
      revisions: [...this.revisions.entries()],
    };
  }

  private database(): Pick<Database, "transaction"> {
    return {
      transaction: async <Result>(
        work: (transaction: DatabaseTransaction) => Promise<Result>,
      ): Promise<Result> => {
        const ticket = this.ticket;
        const criteria = this.criteria.map((entry) => ({ ...entry }));
        const revisions = new Map(this.revisions);
        const keys = new Map(this.keys);
        const writes = { ...this.writes };
        const historyLength = this.history.length;
        try {
          return await work(this.connection);
        } catch (error: unknown) {
          // A real transaction rolls everything back; the mock restores its snapshot.
          this.ticket = ticket;
          this.criteria = criteria;
          this.revisions = revisions;
          this.keys.clear();
          keys.forEach((stored, id) => this.keys.set(id, stored));
          Object.assign(this.writes, writes);
          this.history.length = historyLength;
          throw error;
        }
      },
    };
  }

  private async queryRevisions(
    statement: string,
    parameters: SqlParameters = {},
  ): Promise<DatabaseValue[][]> {
    if (!statement.includes("work_item_checklist_revisions"))
      throw new Error("Unexpected database query");
    const stored = this.revisions.get(String(parameters.work_item_id));
    return stored ? [[String(stored.revision), stored.contentHash]] : [];
  }

  private async executeRevisions(
    statement: string,
    parameters: SqlParameters = {},
  ): Promise<void> {
    if (!statement.includes("work_item_checklist_revisions"))
      throw new Error("Unexpected database write");
    this.revisions.set(String(parameters.work_item_id), {
      revision: Number(parameters.revision),
      contentHash: String(parameters.content_hash),
    });
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
    ).mockImplementation(
      async (projectId, userId) =>
        projectId === "engineering" && userId === "writer",
    );
    vi.spyOn(ProjectRepository.prototype, "insertActivity").mockResolvedValue();
  }

  private mockTickets(): void {
    vi.spyOn(TaskRepository.prototype, "findById").mockImplementation(
      async (id) => (id === this.ticket.id ? this.ticket : null),
    );
    vi.spyOn(TaskRepository.prototype, "findByKey").mockImplementation(
      async (key) => (key === this.ticket.key ? this.ticket : null),
    );
    vi.spyOn(
      TaskRepository.prototype,
      "findChecklistItemsByWorkItemId",
    ).mockImplementation(async () =>
      this.criteria.map((entry) => ({ ...entry })),
    );
    vi.spyOn(
      TaskRepository.prototype,
      "findChecklistItemById",
    ).mockImplementation(
      async (id) => this.criteria.find((entry) => entry.id === id) ?? null,
    );
    vi.spyOn(
      TaskRepository.prototype,
      "updateChecklistItem",
    ).mockImplementation(async (id, update) => {
      this.criteria = this.criteria.map((entry) =>
        entry.id === id
          ? { ...entry, isDone: update.isDone ?? entry.isDone }
          : entry,
      );
      this.writes.criteria += 1;
    });
    vi.spyOn(TaskRepository.prototype, "updateDescription").mockImplementation(
      async (id, description, baseDescription) => {
        if (this.isDescriptionWriteFailing)
          throw new Error("Synthetic storage failure");
        if (
          id !== this.ticket.id ||
          this.ticket.description !== baseDescription
        )
          return false;
        this.ticket = { ...this.ticket, description };
        this.writes.descriptions += 1;
        return true;
      },
    );
    vi.spyOn(TaskRepository.prototype, "insertHistory").mockImplementation(
      async (entry) => {
        this.history.push(entry);
      },
    );
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
