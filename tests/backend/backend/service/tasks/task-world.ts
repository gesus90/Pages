import { vi } from "vitest";

import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { GitHubSyncService } from "@/backend/service/GitHubSyncService";
import { TaskService } from "@/backend/service/TaskService";

import { ProjectWorld } from "../project/project-service-world";

import { bareInstance } from "./bare-instance";
import {
  installChecklistAndLinks,
  installLabelStore,
} from "./task-catalog-store";
import {
  installInitiativeLinks,
  installMilestoneStore,
} from "./task-planning-store";
import { emptyTaskState, milestoneRecord, ticketRecord } from "./task-records";
import {
  installConditionalWrites,
  installTicketHistory,
  installTicketLifecycle,
  installTicketReads,
  installTicketWrites,
} from "./task-ticket-store";

import type { Database } from "@/backend/database/Database";
import type { ArchivePersonOptions } from "../agents/archive-records";
import type { Milestone, WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";
import type { TaskState } from "./task-records";

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

/**
 * Synthetic ticket persistence behind the real task services.
 *
 * @remarks
 * Project access and account facts come from the real project services on a
 * {@link ProjectWorld}; repository methods are replaced on the prototype by
 * in-memory behavior and every other repository method fails loudly.
 */
export class TaskWorld {
  public readonly state: TaskState = emptyTaskState();
  public readonly projects: ProjectWorld;
  public readonly repository: TaskRepository;
  public readonly tasks: TaskService;
  /** Publications that reached the synthetic GitHub boundary. */
  public readonly published: string[] = [];

  public constructor() {
    this.projects = new ProjectWorld();
    this.repository = new TaskRepository(unexpectedDatabase());
    installTicketReads(this.state);
    installTicketWrites(this.state);
    installConditionalWrites(this.state);
    installTicketLifecycle(this.state);
    installTicketHistory(this.state);
    installMilestoneStore(this.state);
    installInitiativeLinks(this.state);
    installLabelStore(this.state);
    installChecklistAndLinks(this.state);
    this.tasks = new TaskService(
      this.repository,
      this.projects.service,
      this.projects.permissions,
      this.projects.cache,
    );
    this.projects.addProject("beta", ["design"]);
    this.projects.addProject("spare", ["engineering"]);
    this.addPerson("manager", {
      capabilities: ["write", "milestones", "manage_projects"],
      managedDepartments: ["engineering"],
    });
    this.addPerson("milestoner", { capabilities: ["write", "milestones"] });
    this.addPerson("reader", { capabilities: [] });
    for (const id of ["admin", "lead", "writer", "outsider"])
      this.state.people.push(this.projects.user(id));
  }

  /** Adds an account that may also be assigned to tickets. */
  public addPerson(id: string, options: ArchivePersonOptions = {}): void {
    this.projects.addPerson(id, options);
    this.state.people = this.state.people.filter((person) => person.id !== id);
    this.state.people.push(this.projects.user(id));
  }

  /** The user row an actor presents. */
  public user(id: string): User {
    return this.projects.user(id);
  }

  /** Stores a ticket with the given overrides. */
  public addTicket(id: string, overrides: Partial<WorkItemDetail> = {}): void {
    this.state.tickets.set(id, ticketRecord(id, overrides));
  }

  /** Stores a milestone of a project. */
  public addMilestone(
    id: string,
    projectId: string,
    overrides: Partial<Milestone> = {},
  ): void {
    this.state.milestones.set(id, milestoneRecord(id, projectId, overrides));
  }

  /** A stored ticket exactly as persisted. */
  public ticket(id: string): WorkItemDetail {
    const stored = this.state.tickets.get(id);
    if (!stored) throw new Error(`Unknown synthetic ticket ${id}`);
    return stored;
  }

  /** The history actions recorded for a ticket, in order. */
  public actions(ticketId: string): string[] {
    return this.state.history
      .filter((entry) => entry.workItemId === ticketId)
      .map((entry) => entry.action);
  }

  /** Seeds a full hierarchy of one project: initiative, epic, task, subtask. */
  public addHierarchy(projectId = "alpha"): void {
    const common = { projectId, projectName: projectId };
    this.addTicket("ini", { ...common, type: "initiative", key: "ALP-1" });
    this.addTicket("epic", {
      ...common,
      type: "epic",
      parentId: "ini",
      key: "ALP-2",
    });
    this.addTicket("task", {
      ...common,
      type: "task",
      parentId: "epic",
      key: "ALP-3",
    });
    this.addTicket("sub", {
      ...common,
      type: "subtask",
      parentId: "task",
      key: "ALP-4",
    });
  }

  /** Connects a synthetic GitHub publication boundary. */
  public attachGitHub(publish: (item: WorkItemDetail) => Promise<void>): void {
    const sync = bareInstance(GitHubSyncService.prototype);
    vi.spyOn(sync, "publishTaskUpdate").mockImplementation(async (_, item) => {
      this.published.push(item.id);
      await publish(item);
    });
    this.tasks.setGitHubSync(sync);
  }

  /** Lets fire-and-forget work of a service finish. */
  public async settle(): Promise<void> {
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  }
}
