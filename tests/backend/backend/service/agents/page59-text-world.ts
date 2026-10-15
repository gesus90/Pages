import { vi } from "vitest";

import { Database } from "@/backend/database/Database";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { ProjectActivityRepository } from "@/backend/database/repositories/project/ProjectActivityRepository";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { createAgentPlanningServices } from "@/backend/service/agents/AgentPlanningServices";
import { AgentWikiFieldService } from "@/backend/service/agents/AgentWikiFieldService";
import { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { AgentProjectService } from "@/backend/service/mcp/AgentProjectService";
import { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";
import { CAPABILITY } from "@/definition/Authorization";

import {
  archiveAccount,
  archiveProject,
  archiveTicket,
  archiveUser,
} from "./archive-records";
import { mockTextWiki, textWikiPage } from "./page59-wiki-storage";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { NewWorkItemHistory } from "@/backend/database/repositories/TaskRepository";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { NewProjectActivity } from "@/backend/database/repositories/project/ProjectActivityRepository";
import type { NewWikiVersion } from "@/backend/database/repositories/wiki/WikiVersionRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { AgentTicketPublisher } from "@/backend/service/agents/AgentTicketAnnouncer";
import type { AgentTextExcerpt } from "@/definition/AgentTextRange";
import type { ArchivePersonOptions } from "./archive-records";

/** The two public text targets, exercised through the production dispatcher. */
export const TEXT_TARGETS = ["wiki", "ticket"] as const;
export type TextTarget = (typeof TEXT_TARGETS)[number];

type AgentResult = Awaited<
  ReturnType<AgentOperationRouter["handle"]>
>["result"];

/** In-memory persistence and outbound boundaries; all policy and mutation services are real. */
export class TextWorld {
  public ticket = archiveTicket("ticket-59", {
    key: "SYN-59",
    parentId: "parent",
    parentKey: "SYN-1",
  });
  public page = textWikiPage();
  public person: ArchivePersonOptions = { capabilities: [CAPABILITY.WRITE] };
  public readonly history: NewWorkItemHistory[] = [];
  public readonly versions: {
    version: NewWikiVersion;
    coalesceMinutes: number;
  }[] = [];
  public readonly activity: NewProjectActivity[] = [];
  public readonly events: PagesEvent[] = [];
  public readonly links: unknown[] = [];
  public readonly mentions: unknown[] = [];
  public readonly keys = new Map<string, StoredAgentOperation>();
  public readonly publish = vi.fn<AgentTicketPublisher["publish"]>(
    async (): Promise<void> => {
      if (this.isInTransaction) throw new Error("Published before commit");
    },
  );
  public readonly invalidate = vi.fn();
  public readonly router: AgentOperationRouter;
  public readonly api: PagesAgentApiService;
  public isHistoryFailing = false;
  public isDescriptionRacing = false;
  public isInTransaction = false;
  private operationCounter = 0;

  public constructor() {
    // No connection is created: every method usable by this fixture is replaced below.
    const unconnected: unknown = Object.create(Database.prototype);
    const database = unconnected as Database;
    vi.spyOn(database, "query").mockRejectedValue(
      new Error("Unexpected SQL query"),
    );
    vi.spyOn(database, "execute").mockRejectedValue(
      new Error("Unexpected SQL write"),
    );
    vi.spyOn(database, "transaction").mockImplementation(async (work) =>
      this.transaction(database, work),
    );
    this.mockAccounts();
    this.mockTickets();
    this.mockOperations();
    mockTextWiki(this);
    const events = new PagesEventPublisher();
    events.subscribe((event) => {
      if (this.isInTransaction) throw new Error("Announced before commit");
      this.events.push(event);
    });
    const users = { getById: async () => archiveUser("writer", this.person) };
    this.router = new AgentOperationRouter({
      projects: new ProjectRepository(database),
      wiki: new WikiRepository(database),
      users,
      planning: createAgentPlanningServices({
        database,
        users,
        events,
        cache: { invalidateWorkItems: this.invalidate },
        publisher: { publish: this.publish },
      }),
      fields: new AgentWikiFieldService({ database, events }),
    });
    // The credential store is the transport boundary; authorization below uses current account facts.
    const credentialStore: unknown = Object.create(
      PersonalAgentTokenService.prototype,
    );
    const personal = credentialStore as PersonalAgentTokenService;
    vi.spyOn(personal, "verify").mockResolvedValue({
      userId: "writer",
      isAdmin: false,
      permissions: [],
    });
    vi.spyOn(personal, "credential").mockResolvedValue(null);
    this.api = new PagesAgentApiService(
      personal,
      new AgentProjectService(new ProjectRepository(database)),
      this.router,
    );
  }

  /** Replaces the initial stored text without calling a service, for arranging a case. */
  public seed(text: string): void {
    this.ticket = { ...this.ticket, description: text };
    this.page = { ...this.page, content: text };
  }

  /** Returns only the stored text of the named target. */
  public text(target: TextTarget): string {
    return target === "wiki" ? this.page.content : this.ticket.description;
  }

  /** Builds the target spelling accepted by the MCP-facing operations. */
  public target(target: TextTarget): Readonly<Record<string, unknown>> {
    return target === "wiki"
      ? { pageId: this.page.id }
      : { ticketId: this.ticket.key };
  }

  /** Runs an Agent API operation with a credential carrying no cached rights. */
  public async call(
    operation: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<AgentResult> {
    const response = await this.api.handle("synthetic-personal-token", {
      operation,
      parameters,
    });
    if (!("result" in response))
      throw new Error("Unexpected operation response");
    return response.result;
  }

  /** Reads a passage through the public operation and narrows the result for continuation reads. */
  public async read(
    target: TextTarget,
    parameters: Readonly<Record<string, unknown>> = {},
  ): Promise<AgentTextExcerpt> {
    const result = await this.call(
      target === "wiki"
        ? "wiki.page.readRange"
        : "ticket.description.readRange",
      { ...this.target(target), start: { line: 1 }, ...parameters },
    );
    if (
      typeof result !== "object" ||
      result === null ||
      !("text" in result) ||
      !("start" in result) ||
      !("next" in result) ||
      !("truncated" in result)
    )
      throw new Error("Unexpected excerpt");
    return result;
  }

  /** Builds a patch from a freshly read public revision or description version. */
  public async patchParameters(
    target: TextTarget,
    overrides: Readonly<Record<string, unknown>> = {},
  ): Promise<Readonly<Record<string, unknown>>> {
    const read = await this.read(target);
    const version =
      "revision" in read
        ? { expectedRevision: read.revision }
        : {
            expectedDescriptionVersion:
              "descriptionVersion" in read
                ? read.descriptionVersion
                : undefined,
          };
    this.operationCounter += 1;
    return {
      ...this.target(target),
      ...version,
      operationId: `text-${this.operationCounter}`,
      start: { line: 1, column: 1 },
      end: { line: 1, column: 2 },
      expectedText: this.text(target).slice(0, 1),
      replacementText: "X",
      ...overrides,
    };
  }

  /** Sends an already prepared patch, allowing exact replay after a lost response. */
  public async patch(
    target: TextTarget,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    return this.call(
      target === "wiki" ? "wiki.page.patchContent" : "ticket.patchDescription",
      parameters,
    );
  }

  /** Captures everything a refused or repeated operation must leave alone. */
  public stored(): unknown {
    return structuredClone({
      ticket: this.ticket,
      page: this.page,
      history: this.history,
      versions: this.versions,
      activity: this.activity,
      events: this.events,
      links: this.links,
      mentions: this.mentions,
      keys: [...this.keys],
      published: this.publish.mock.calls.length,
      invalidations: this.invalidate.mock.calls.length,
    });
  }

  private async transaction<Result>(
    connection: DatabaseTransaction,
    work: (connection: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> {
    const ticket = this.ticket;
    const page = this.page;
    const keys = new Map(this.keys);
    const collections = [
      this.history,
      this.versions,
      this.activity,
      this.links,
      this.mentions,
    ];
    const lengths = collections.map((entries) => entries.length);
    this.isInTransaction = true;
    try {
      return await work(connection);
    } catch (error: unknown) {
      this.ticket = ticket;
      this.page = page;
      this.keys.clear();
      keys.forEach((stored, id) => this.keys.set(id, stored));
      collections.forEach((entries, index) => {
        entries.length = lengths[index];
      });
      throw error;
    } finally {
      this.isInTransaction = false;
    }
  }

  private mockAccounts(): void {
    const project = archiveProject("engineering", ["engineering"]);
    vi.spyOn(UserRepository.prototype, "findById").mockImplementation(
      async () => archiveUser("writer", this.person),
    );
    vi.spyOn(AuthorizationRepository.prototype, "snapshot").mockImplementation(
      async () => ({
        accounts: [archiveAccount("writer", this.person)],
        roles: [],
        departments: [],
      }),
    );
    vi.spyOn(ProjectRepository.prototype, "findById").mockImplementation(
      async (id) => (id === project.id ? project : null),
    );
    vi.spyOn(ProjectRepository.prototype, "findAll").mockResolvedValue([
      project,
    ]);
    vi.spyOn(ProjectRepository.prototype, "findActiveIds").mockResolvedValue([
      project.id,
    ]);
    vi.spyOn(
      ProjectRepository.prototype,
      "findDepartmentsByProjects",
    ).mockResolvedValue(new Map([[project.id, [...project.departments]]]));
    vi.spyOn(ProjectRepository.prototype, "isProjectManager").mockResolvedValue(
      false,
    );
    vi.spyOn(ProjectRepository.prototype, "insertActivity").mockImplementation(
      async (entry) => {
        this.activity.push(entry);
      },
    );
    vi.spyOn(ProjectActivityRepository.prototype, "insert").mockImplementation(
      async (entry) => {
        this.activity.push(entry);
      },
    );
  }

  private mockTickets(): void {
    vi.spyOn(TaskRepository.prototype, "findAllStatuses").mockResolvedValue([]);
    vi.spyOn(
      TaskRepository.prototype,
      "findEligibleAssigneesByProjectIds",
    ).mockResolvedValue(new Map());
    vi.spyOn(
      TaskRepository.prototype,
      "findLabelsForWorkItemIds",
    ).mockResolvedValue(new Map());
    vi.spyOn(TaskRepository.prototype, "findAll").mockImplementation(
      async () => [this.ticket],
    );
    vi.spyOn(UserGroupRepository.prototype, "findAll").mockResolvedValue([]);
    vi.spyOn(TaskRepository.prototype, "findById").mockImplementation(
      async (id) => (id === this.ticket.id ? this.ticket : null),
    );
    vi.spyOn(TaskRepository.prototype, "findByKey").mockImplementation(
      async (key) => (key === this.ticket.key ? this.ticket : null),
    );
    vi.spyOn(TaskRepository.prototype, "updateDescription").mockImplementation(
      async (id, description, baseDescription) => {
        if (
          this.isDescriptionRacing ||
          id !== this.ticket.id ||
          this.ticket.description !== baseDescription
        )
          return false;
        this.ticket = { ...this.ticket, description };
        return true;
      },
    );
    vi.spyOn(TaskRepository.prototype, "insertHistory").mockImplementation(
      async (entry) => {
        if (this.isHistoryFailing) throw new Error("Synthetic history failure");
        this.history.push(entry);
      },
    );
  }

  private mockOperations(): void {
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
