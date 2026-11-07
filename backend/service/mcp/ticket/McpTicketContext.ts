import { WorkItemNotFoundError } from "@/backend/error/WorkItemErrors";

import { McpTicketError } from "./McpTicketError";

import type { ProjectService } from "@/backend/service/ProjectService";
import type { TaskService } from "@/backend/service/TaskService";
import type { TaskTemplateService } from "@/backend/service/TaskTemplateService";
import type { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import type { UserService } from "@/backend/service/UserService";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";
import type { McpTicketPerson } from "./McpTicketContract";

/** A ticket key such as `PAGE-12`; anything else names a ticket by its id. */
const TICKET_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]*-\d+$/u;

/**
 * The services the ticket API calls: the very ones the interface uses.
 *
 * @remarks
 * The API adds no business logic and no right of its own; every call goes
 * through these services with the paired account as the actor.
 */
export interface McpTicketDependencies {
  readonly tasks: TaskService;
  readonly templates: TaskTemplateService;
  readonly attachments: TaskAttachmentService;
  readonly projects: Pick<ProjectService, "findAll" | "getById">;
  readonly users: Pick<UserService, "getById">;
}

/**
 * Everything one request of the ticket API works with: the account of the
 * paired machine, the services and the people it has resolved so far.
 */
export class McpTicketContext {
  public readonly actor: User;
  public readonly services: McpTicketDependencies;
  private readonly people = new Map<string, Promise<User | null>>();
  private visible: Promise<readonly User[]> | null = null;

  /**
   * Creates the context of one request.
   *
   * @param actor - The account the device token acts for.
   * @param services - The ticket services of the interface.
   */
  public constructor(actor: User, services: McpTicketDependencies) {
    this.actor = actor;
    this.services = services;
  }

  /**
   * Reads a ticket by key or id with the visibility rules of the interface.
   *
   * @param reference - `PAGE-12` or the id of the ticket.
   * @returns The ticket, archived ones included.
   * @throws {WorkItemNotFoundError} When it does not exist or is hidden.
   */
  public async ticket(reference: string): Promise<WorkItemDetail> {
    const trimmed = reference.trim();
    if (trimmed === "") throw new WorkItemNotFoundError();
    return TICKET_KEY_PATTERN.test(trimmed)
      ? this.services.tasks.getByKey(this.actor, trimmed.toUpperCase())
      : this.services.tasks.getById(this.actor, trimmed);
  }

  /**
   * Names a person by username and display name.
   *
   * @param userId - Internal id of the person, or `null`.
   * @returns The person, or `null` for none or an account that no longer exists.
   */
  public async person(userId: string | null): Promise<McpTicketPerson | null> {
    if (userId === null) return null;
    let pending = this.people.get(userId);
    if (pending === undefined) {
      pending = this.services.users.getById(userId);
      this.people.set(userId, pending);
    }
    const user = await pending;
    return user
      ? { username: user.username, displayName: user.displayName }
      : null;
  }

  /**
   * Resolves a username to a person the account can see.
   *
   * @remarks
   * Visible are the people who may work in at least one project of the
   * account; everyone else answers like an unknown name.
   *
   * @param username - The username from the request.
   * @throws {McpTicketError} `not_found` for an unknown or hidden person.
   */
  public async requireVisiblePerson(username: string): Promise<User> {
    const wanted = username.trim().toLowerCase();
    const person = (await this.visiblePeople()).find(
      (candidate) => candidate.username.toLowerCase() === wanted,
    );
    if (!person) throw new McpTicketError("not_found");
    return person;
  }

  /**
   * Resolves a username to a person who may receive tickets of a project.
   *
   * @param projectId - The project of the ticket.
   * @param username - The username from the request.
   * @returns The id of the person.
   * @throws {McpTicketError} `not_found` for an unknown or hidden person,
   * `invalid_request` for one who may not receive tickets there.
   */
  public async requireAssignablePerson(
    projectId: string,
    username: string,
  ): Promise<string> {
    const person = await this.requireVisiblePerson(username);
    const eligible = await this.services.tasks.findEligibleAssignees(
      this.actor,
      projectId,
    );
    if (!eligible.some((candidate) => candidate.id === person.id))
      throw new McpTicketError("invalid_request");
    return person.id;
  }

  private async visiblePeople(): Promise<readonly User[]> {
    this.visible ??= this.loadVisiblePeople();
    return this.visible;
  }

  private async loadVisiblePeople(): Promise<readonly User[]> {
    const projects = await this.services.projects.findAll(this.actor);
    const byProject = await this.services.tasks.findAssigneesByProjects(
      projects.map((project) => project.id),
    );
    const people = new Map<string, User>();
    for (const users of byProject.values())
      for (const user of users) people.set(user.id, user);
    return [...people.values()];
  }
}
