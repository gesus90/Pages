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
   * Returns, per project, the groups that have a member who can work in it.
   *
   * @remarks
   * Only group ids leave the service, so the answer does not reveal who
   * belongs to a group. A group without such a member cannot do the ticket's
   * work, so assignment controls leave it out.
   *
   * @param actor - Signed-in user; must still be an active account.
   * @param assigneesByProject - The people with access to each project.
   * @returns The group ids by project id, in group name order.
   */
  public async findGroupIdsByProject(
    actor: User,
    assigneesByProject: Readonly<Record<string, readonly User[]>>,
  ): Promise<Record<string, string[]>> {
    await this.access.authorizationFacts(actor);

    const groups = await this.taskRepository.findAssigneeGroupsWithMembers();

    return Object.fromEntries(
      Object.entries(assigneesByProject).map(([projectId, assignees]) => {
        const assigneeIds = new Set(assignees.map((assignee) => assignee.id));
        const groupIds = groups
          .filter((group) =>
            group.memberIds.some((memberId) => assigneeIds.has(memberId)),
          )
          .map((group) => group.id);

        return [projectId, groupIds];
      }),
    );
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
