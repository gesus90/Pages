import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type {
  DiscordMilestoneFacts,
  DiscordSubjectReader,
  DiscordTicketFacts,
} from "@/backend/service/discord/DiscordNotificationService";

/**
 * Reads the facts of tickets and milestones for notifications.
 *
 * @remarks
 * It runs without a user: a notification goes to a shared channel, so it
 * carries only the few facts of a message and the notification service decides
 * what may be announced. Archived items are not found, so archiving never
 * announces itself as a change.
 */
export class DiscordSubjectLookup implements DiscordSubjectReader {
  private readonly tasks: Pick<
    TaskRepository,
    "findById" | "findMilestoneById"
  >;
  private readonly projects: Pick<ProjectRepository, "findById">;

  /**
   * Creates the lookup.
   *
   * @param tasks - Ticket and milestone persistence.
   * @param projects - Project persistence, for the project name of a milestone.
   */
  public constructor(
    tasks: Pick<TaskRepository, "findById" | "findMilestoneById">,
    projects: Pick<ProjectRepository, "findById">,
  ) {
    this.tasks = tasks;
    this.projects = projects;
  }

  /** Returns the facts of a ticket, or `null` when it does not exist or is archived. */
  public async findTicket(id: string): Promise<DiscordTicketFacts | null> {
    const ticket = await this.tasks.findById(id);

    if (!ticket) {
      return null;
    }

    return {
      departmentId: ticket.departmentId,
      key: ticket.key,
      projectId: ticket.projectId,
      projectName: ticket.projectName,
      statusName: ticket.statusName,
      title: ticket.title,
    };
  }

  /** Returns the facts of a milestone, or `null` when it does not exist or is archived. */
  public async findMilestone(
    id: string,
  ): Promise<DiscordMilestoneFacts | null> {
    const milestone = await this.tasks.findMilestoneById(id);

    if (!milestone) {
      return null;
    }

    const project = await this.projects.findById(milestone.projectId);

    if (!project) {
      return null;
    }

    return {
      name: milestone.name,
      projectId: milestone.projectId,
      projectName: project.name,
      status: milestone.status,
    };
  }
}
