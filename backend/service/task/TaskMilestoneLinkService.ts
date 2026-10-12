import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type {
  MilestoneInitiativeLink,
  TaskRepository,
} from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";
import type { Milestone, WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

/** What a link change did; `isChanged` is false when the link was already as asked. */
export interface MilestoneInitiativeChange {
  readonly projectId: string;
  readonly milestoneId: string;
  readonly initiativeId: string;
  readonly isChanged: boolean;
}

/**
 * Keeps the links between milestones and initiatives (T6.13.1, T6.13.2).
 *
 * @remarks
 * A ticket carries exactly one milestone. An initiative can span several, so
 * it also keeps rows in a link table; its own milestone counts as one of them.
 * Assigning a task to a milestone threads the milestone upwards: the epic
 * takes it when it has none, and the initiative is linked. Removing a link
 * never leaves an epic, task or subtask below the initiative behind.
 */
export class TaskMilestoneLinkService {
  private readonly taskRepository: TaskRepository;
  private readonly access: TaskAccessGuard;
  private readonly history: TaskHistoryRecorder;
  private readonly cache: ServerCache;

  /**
   * Creates a milestone link service.
   *
   * @param taskRepository - Task persistence boundary.
   * @param access - Verifier of project access and write permission.
   * @param history - Audit trail receiving the link changes of initiatives.
   * @param cache - Shared server cache.
   */
  public constructor(
    taskRepository: TaskRepository,
    access: TaskAccessGuard,
    history: TaskHistoryRecorder,
    cache: ServerCache,
  ) {
    this.taskRepository = taskRepository;
    this.access = access;
    this.history = history;
    this.cache = cache;
  }

  /**
   * Returns the links of the milestones of the given projects.
   *
   * @param actor - Account whose project access and ticket scope are enforced.
   * @param projectIds - Projects to read.
   * @returns Only links of initiatives the actor may see.
   */
  public async findLinks(
    actor: User,
    projectIds: readonly string[],
  ): Promise<MilestoneInitiativeLink[]> {
    const accessible = await this.access.resolveAccessibleProjectIds(
      actor,
      projectIds,
    );

    if (accessible.length === 0) {
      return [];
    }

    const visibility = await this.access.visibility(actor);
    const [links, initiatives] = await Promise.all([
      this.taskRepository.findMilestoneInitiativeLinks(accessible),
      this.taskRepository.findAll({
        archived: "active",
        projectIds: accessible,
        type: WORK_ITEM_TYPE.INITIATIVE,
        visibility,
      }),
    ]);
    const visible = new Set(initiatives.map(({ id }) => id));

    return links.filter(({ initiativeId }) => visible.has(initiativeId));
  }

  /**
   * Links an initiative with a milestone of its project.
   *
   * @param actor - The person linking; needs write access to the initiative.
   * @param milestoneId - Milestone identifier.
   * @param initiativeId - Initiative identifier.
   * @throws {WorkItemValidationError} When the work item is no active
   * Initiative, or the milestone is missing or of another project.
   */
  public async addInitiative(
    actor: User,
    milestoneId: string,
    initiativeId: string,
  ): Promise<MilestoneInitiativeChange> {
    const initiative = await this.requireInitiative(actor, initiativeId);
    const milestone = await this.requireMilestone(initiative, milestoneId);
    const isChanged = await this.link(actor, milestone, initiative);

    return {
      initiativeId,
      isChanged,
      milestoneId,
      projectId: initiative.projectId,
    };
  }

  /**
   * Removes the link between an initiative and a milestone.
   *
   * @param actor - The person unlinking; needs write access to the initiative.
   * @param milestoneId - Milestone identifier.
   * @param initiativeId - Initiative identifier.
   * @throws {WorkItemValidationError} With `milestoneInitiativeInUse` while an
   * epic, task or subtask below the initiative still carries the milestone.
   */
  public async removeInitiative(
    actor: User,
    milestoneId: string,
    initiativeId: string,
  ): Promise<MilestoneInitiativeChange> {
    const initiative = await this.requireInitiative(actor, initiativeId);
    const milestone = await this.requireMilestone(initiative, milestoneId);
    const result = {
      initiativeId,
      milestoneId,
      projectId: initiative.projectId,
    };

    if (!(await this.isLinked(initiative, milestoneId))) {
      return { ...result, isChanged: false };
    }

    // Hidden descendants count as well, so no ticket is left without its link.
    if (
      (await this.taskRepository.countMilestoneDependents(
        initiative.id,
        milestoneId,
      )) > 0
    ) {
      throw new WorkItemValidationError("milestoneInitiativeInUse");
    }

    await this.taskRepository.unlinkInitiativeFromMilestone(
      milestoneId,
      initiative.id,
    );
    await this.taskRepository.clearMilestone(initiative.id, milestoneId);
    this.cache.invalidateWorkItems();
    await this.history.recordMilestoneUnlinked(
      actor,
      initiative.id,
      milestone.name,
    );

    return { ...result, isChanged: true };
  }

  /**
   * Threads the milestone of a task up to its epic and initiative.
   *
   * @param actor - The person who assigned the task.
   * @param task - The task as it is stored after the assignment.
   *
   * @remarks
   * Only a task that carries a milestone starts the thread, as T6.13.2 words
   * it. The epic keeps a milestone it already has, because it carries exactly
   * one; the initiative is linked in the table. Nothing is ever removed here.
   */
  public async threadAssignedTask(
    actor: User,
    task: WorkItemDetail,
  ): Promise<void> {
    if (
      task.type !== WORK_ITEM_TYPE.TASK ||
      task.milestoneId === null ||
      task.parentId === null ||
      task.archivedAt !== null
    ) {
      return;
    }

    const milestone = await this.taskRepository.findMilestoneById(
      task.milestoneId,
    );
    const epic = await this.taskRepository.findById(task.parentId);

    if (!milestone || epic?.type !== WORK_ITEM_TYPE.EPIC) {
      return;
    }

    if (await this.taskRepository.setMilestoneIfEmpty(epic.id, milestone.id)) {
      this.cache.invalidateWorkItems();
      await this.history.recordMilestoneAdopted(actor, epic.id, milestone.name);
    }

    const initiative = epic.parentId
      ? await this.taskRepository.findById(epic.parentId)
      : null;

    if (
      initiative?.type === WORK_ITEM_TYPE.INITIATIVE &&
      initiative.archivedAt === null
    ) {
      await this.link(actor, milestone, initiative);
    }
  }

  private async link(
    actor: User,
    milestone: Milestone,
    initiative: WorkItemDetail,
  ): Promise<boolean> {
    if (await this.isLinked(initiative, milestone.id)) {
      return false;
    }

    await this.taskRepository.linkInitiativeToMilestone(
      milestone.id,
      initiative.id,
    );
    this.cache.invalidateWorkItems();
    await this.history.recordMilestoneLinked(
      actor,
      initiative.id,
      milestone.name,
    );

    return true;
  }

  private async isLinked(
    initiative: WorkItemDetail,
    milestoneId: string,
  ): Promise<boolean> {
    if (initiative.milestoneId === milestoneId) {
      return true;
    }

    const links = await this.taskRepository.findMilestoneInitiativeLinks([
      initiative.projectId,
    ]);

    return links.some(
      (link) =>
        link.milestoneId === milestoneId && link.initiativeId === initiative.id,
    );
  }

  private async requireInitiative(
    actor: User,
    initiativeId: string,
  ): Promise<WorkItemDetail> {
    const initiative = await this.access.requireWritableWorkItem(
      actor,
      initiativeId,
    );

    if (initiative.type !== WORK_ITEM_TYPE.INITIATIVE) {
      throw new WorkItemValidationError("initiativeRequired");
    }

    if (initiative.archivedAt !== null) {
      throw new WorkItemValidationError("ticketArchived");
    }

    return initiative;
  }

  private async requireMilestone(
    initiative: WorkItemDetail,
    milestoneId: string,
  ): Promise<Milestone> {
    const milestone = await this.taskRepository.findMilestoneById(milestoneId);

    if (!milestone) {
      throw new WorkItemValidationError("milestoneNotFound");
    }

    if (milestone.projectId !== initiative.projectId) {
      throw new WorkItemValidationError("milestoneOtherProject");
    }

    return milestone;
  }
}
