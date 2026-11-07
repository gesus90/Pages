import { ProjectNotFoundError } from "@/backend/error/ProjectErrors";

import { McpProjectError } from "./McpProjectError";

import type { GitHubSyncService } from "@/backend/service/GitHubSyncService";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { TaskService } from "@/backend/service/TaskService";
import type { UserService } from "@/backend/service/UserService";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { ArchivedProjectContents, Project } from "@/definition/Project";
import type { User } from "@/definition/User";
import type { McpProjectPerson } from "./McpProjectContract";

/**
 * The services the project API calls: the very ones the interface uses.
 *
 * @remarks
 * The API adds no business logic and no right of its own; every call goes
 * through these services with the paired account as the actor. The project
 * service is the one of the MCP channel, so the administrator role counts
 * without the role mode of the browser.
 */
export interface McpProjectDependencies {
  readonly projects: ProjectService;
  readonly gitHub: Pick<GitHubSyncService, "testConnection" | "syncProjectNow">;
  readonly tasks: Pick<TaskService, "findEligibleAssignees">;
  readonly users: Pick<UserService, "getById">;
  readonly events: Pick<PagesEventPublisher, "publish">;
}

/** A project with everything the answer object shows, running or archived. */
export interface McpProjectState extends Omit<
  ArchivedProjectContents,
  "project"
> {
  readonly project: Project;
  readonly isArchived: boolean;
}

/**
 * Everything one request of the project API works with: the account of the
 * paired machine and the services.
 */
export class McpProjectContext {
  public readonly actor: User;
  public readonly services: McpProjectDependencies;

  /**
   * Creates the context of one request.
   *
   * @param actor - The account the device token acts for.
   * @param services - The project services of the interface.
   */
  public constructor(actor: User, services: McpProjectDependencies) {
    this.actor = actor;
    this.services = services;
  }

  /**
   * Reads a project with its contents, archived ones included.
   *
   * @param projectId - The id of the project.
   * @throws {ProjectNotFoundError} When it does not exist.
   * @throws {ProjectAccessDeniedError} When the account may not see it.
   *
   * @remarks
   * A running project is read with the reads of the project page; an
   * archived one with the read of the archive.
   */
  public async state(projectId: string): Promise<McpProjectState> {
    const { projects } = this.services;
    let project: Project;
    try {
      project = await projects.getById(this.actor, projectId);
    } catch (error: unknown) {
      if (!(error instanceof ProjectNotFoundError)) throw error;
      const archived = await projects.readArchived(this.actor, projectId);
      return { ...archived, isArchived: true };
    }
    const [members, goals, tags, events, integration] = await Promise.all([
      projects.findMembers(this.actor, projectId),
      projects.findGoals(this.actor, projectId),
      projects.findTags(this.actor, projectId),
      projects.findEvents(this.actor, projectId),
      projects.findIntegration(this.actor, projectId),
    ]);
    return {
      project,
      isArchived: false,
      members,
      goals,
      tags,
      events,
      integration,
    };
  }

  /**
   * Requires a running project the account can see.
   *
   * @remarks
   * Some service methods check the write right first; reading first lets a
   * hidden project answer `not_found` instead of `forbidden`.
   *
   * @param projectId - The id of the project.
   * @throws {ProjectNotFoundError} When no running project has the id.
   * @throws {ProjectAccessDeniedError} When the account may not see it.
   */
  public async requireVisible(projectId: string): Promise<void> {
    await this.services.projects.getById(this.actor, projectId);
  }

  /**
   * Names a person by username and display name.
   *
   * @param userId - Internal id of the person, or `null`.
   * @returns The person, or `null` for none or an account that no longer exists.
   */
  public async person(userId: string | null): Promise<McpProjectPerson | null> {
    if (userId === null) return null;
    const user = await this.services.users.getById(userId);
    return user
      ? { username: user.username, displayName: user.displayName }
      : null;
  }

  /**
   * Resolves a username to a member of the project team.
   *
   * @param projectId - The running project.
   * @param username - The username from the request.
   * @returns The id of the member, or `null` when the person is no member.
   */
  public async findMember(
    projectId: string,
    username: string,
  ): Promise<string | null> {
    const members = await this.services.projects.findMembers(
      this.actor,
      projectId,
    );
    const wanted = username.trim().toLowerCase();
    return (
      members.find((member) => member.username.toLowerCase() === wanted)
        ?.userId ?? null
    );
  }

  /**
   * Resolves a username to a person who may join the team, like the choice
   * of the project page offers them; members keep their place.
   *
   * @param projectId - The running project.
   * @param username - The username from the request.
   * @returns The id of the person.
   * @throws {McpProjectError} `not_found` for an unknown or hidden person.
   */
  public async requireCandidate(
    projectId: string,
    username: string,
  ): Promise<string> {
    const member = await this.findMember(projectId, username);
    if (member !== null) return member;
    const wanted = username.trim().toLowerCase();
    const eligible = await this.services.tasks.findEligibleAssignees(
      this.actor,
      projectId,
    );
    const person = eligible.find(
      (candidate) => candidate.username.toLowerCase() === wanted,
    );
    if (!person) throw new McpProjectError("not_found");
    return person.id;
  }

  /**
   * Announces a change that may take the project out of somebody's sight,
   * like the interface does after archiving, deleting or reassigning.
   *
   * @param projectId - The changed project.
   */
  public announceAccessChange(projectId: string): void {
    this.services.events.publish({
      type: "project.access.changed",
      id: projectId,
    });
  }
}
