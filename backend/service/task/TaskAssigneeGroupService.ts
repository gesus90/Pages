import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { GroupSummary } from "@/definition/UserGroup";
import type { User } from "@/definition/User";

/** Offers the user groups that tickets can be assigned to. */
export class TaskAssigneeGroupService {
  private readonly taskRepository: TaskRepository;
  private readonly access: TaskAccessGuard;

  /**
   * Creates a group lookup for ticket assignment.
   *
   * @param taskRepository - Task persistence boundary.
   * @param access - Guard resolving the active account of the actor.
   */
  public constructor(taskRepository: TaskRepository, access: TaskAccessGuard) {
    this.taskRepository = taskRepository;
    this.access = access;
  }

  /**
   * Returns every group with its member count for assignment controls.
   *
   * @remarks
   * Group names are not confidential within the instance: tickets show them to
   * everyone who sees the ticket. Management details stay in the user
   * administration.
   *
   * @param actor - Signed-in user; must still be an active account.
   */
  public async findGroups(actor: User): Promise<GroupSummary[]> {
    await this.access.authorizationFacts(actor);

    return this.taskRepository.findAssigneeGroups();
  }

  /**
   * Returns the ids of the groups the actor belongs to, for "my tickets" views.
   *
   * @param actor - Signed-in user; must still be an active account.
   */
  public async findMemberGroupIds(actor: User): Promise<string[]> {
    await this.access.authorizationFacts(actor);

    return this.taskRepository.findGroupIdsByMember(actor.id);
  }
}
