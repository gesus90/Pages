import { McpProjectError } from "./McpProjectError";
import { currentProject } from "./McpProjectProjection";

import type { ProjectRole } from "@/definition/Project";
import type { McpProject } from "./McpProjectContract";
import type { McpProjectContext } from "./McpProjectContext";
import type { McpProjectEventRequest } from "./McpProjectRequest";

/** The type a date gets without one, like on the project page. */
const DEFAULT_EVENT_TYPE = "general";

/** Changes the team, the goals and the dates of a project (PAGE-244, interface 5–8). */
export class McpProjectPlanningService {
  /**
   * Adds a person to the team or changes the role of a member.
   *
   * @param context - The request.
   * @param projectId - The project.
   * @param member - Username and new role of the person.
   * @returns The changed project.
   * @throws {McpProjectError} `not_found` for an unknown or hidden person.
   */
  public async setMember(
    context: McpProjectContext,
    projectId: string,
    member: { readonly username: string; readonly role: ProjectRole },
  ): Promise<McpProject> {
    const { actor, services } = context;
    const { username, role } = member;
    const memberId = await context.findMember(projectId, username);
    if (memberId === null)
      await services.projects.addMember(
        actor,
        projectId,
        await context.requireCandidate(projectId, username),
        role,
      );
    else
      await services.projects.updateMemberRole(
        actor,
        projectId,
        memberId,
        role,
      );
    return currentProject(context, projectId);
  }

  /**
   * Removes a member from the team.
   *
   * @param context - The request.
   * @param projectId - The project.
   * @param username - The member.
   * @returns The changed project.
   * @throws {McpProjectError} `not_found` for a person who is no member.
   */
  public async removeMember(
    context: McpProjectContext,
    projectId: string,
    username: string,
  ): Promise<McpProject> {
    const memberId = await context.findMember(projectId, username);
    if (memberId === null) throw new McpProjectError("not_found");
    await context.services.projects.removeMember(
      context.actor,
      projectId,
      memberId,
    );
    return currentProject(context, projectId);
  }

  /**
   * Adds a goal.
   *
   * @param context - The request.
   * @param projectId - The project.
   * @param title - The validated title.
   * @returns The changed project.
   */
  public async createGoal(
    context: McpProjectContext,
    projectId: string,
    title: string,
  ): Promise<McpProject> {
    await context.requireVisible(projectId);
    await context.services.projects.createGoal(context.actor, projectId, title);
    return currentProject(context, projectId);
  }

  /**
   * Marks a goal as done or open again.
   *
   * @param context - The request.
   * @param reference - The project and the goal.
   * @param isDone - The new state.
   * @returns The changed project.
   * @throws {McpProjectError} `not_found` for a goal the project does not have.
   */
  public async setGoalDone(
    context: McpProjectContext,
    reference: { readonly projectId: string; readonly goalId: string },
    isDone: boolean,
  ): Promise<McpProject> {
    const { actor, services } = context;
    const { projectId, goalId } = reference;
    const goal = (await services.projects.findGoals(actor, projectId)).find(
      (entry) => entry.id === goalId,
    );
    if (!goal) throw new McpProjectError("not_found");
    await services.projects.updateGoal(actor, projectId, goalId, {
      isDone,
      title: goal.title,
    });
    return currentProject(context, projectId);
  }

  /**
   * Deletes a goal.
   *
   * @param context - The request.
   * @param projectId - The project.
   * @param goalId - The goal.
   * @returns The changed project.
   * @throws {McpProjectError} `not_found` for a goal the project does not have.
   */
  public async deleteGoal(
    context: McpProjectContext,
    projectId: string,
    goalId: string,
  ): Promise<McpProject> {
    const { actor, services } = context;
    const goals = await services.projects.findGoals(actor, projectId);
    if (!goals.some((goal) => goal.id === goalId))
      throw new McpProjectError("not_found");
    await services.projects.deleteGoal(actor, projectId, goalId);
    return currentProject(context, projectId);
  }

  /**
   * Adds a date to the project calendar.
   *
   * @param context - The request.
   * @param projectId - The project.
   * @param event - The validated date.
   * @returns The changed project.
   */
  public async createEvent(
    context: McpProjectContext,
    projectId: string,
    event: McpProjectEventRequest,
  ): Promise<McpProject> {
    await context.requireVisible(projectId);
    await context.services.projects.createEvent(context.actor, projectId, {
      description: event.description ?? "",
      eventDate: event.date,
      eventTime: event.time ?? null,
      title: event.title,
      type: event.type ?? DEFAULT_EVENT_TYPE,
    });
    return currentProject(context, projectId);
  }

  /**
   * Archives a date of the project calendar.
   *
   * @param context - The request.
   * @param projectId - The project.
   * @param eventId - The date.
   * @returns The changed project.
   * @throws {McpProjectError} `not_found` for a date the project does not have.
   */
  public async archiveEvent(
    context: McpProjectContext,
    projectId: string,
    eventId: string,
  ): Promise<McpProject> {
    const { actor, services } = context;
    const events = await services.projects.findEvents(actor, projectId);
    if (!events.some((event) => event.id === eventId))
      throw new McpProjectError("not_found");
    await services.projects.archiveEvent(actor, projectId, eventId);
    return currentProject(context, projectId);
  }
}
