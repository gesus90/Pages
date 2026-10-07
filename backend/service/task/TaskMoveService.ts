import {
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import type { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";
import type {
  KeySequence,
  WorkItemNumbering,
} from "@/backend/service/task/WorkItemNumbering";
import type { WorkItemReferenceValidator } from "@/backend/service/task/WorkItemReferenceValidator";
import type { Project } from "@/definition/Project";
import type { WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

/** Collaborators of the move service. */
export interface TaskMoveServiceDependencies {
  readonly taskRepository: TaskRepository;
  readonly access: TaskAccessGuard;
  readonly validator: WorkItemReferenceValidator;
  readonly numbering: WorkItemNumbering;
  readonly history: TaskHistoryRecorder;
  readonly cache: ServerCache;
}

/** The moved subtree and the project that receives it. */
interface SubtreeMove {
  readonly subtree: readonly WorkItemDetail[];
  readonly targetProject: Project;
}

/** The new key and number of one moved work item. */
interface ItemPlacement {
  readonly key: string;
  readonly number: number;
}

/** Moves work items with their descendants between projects. */
export class TaskMoveService {
  private readonly taskRepository: TaskRepository;
  private readonly access: TaskAccessGuard;
  private readonly validator: WorkItemReferenceValidator;
  private readonly numbering: WorkItemNumbering;
  private readonly history: TaskHistoryRecorder;
  private readonly cache: ServerCache;

  /**
   * Creates a move service.
   *
   * @param dependencies - Collaborators the service moves through.
   */
  public constructor(dependencies: TaskMoveServiceDependencies) {
    this.taskRepository = dependencies.taskRepository;
    this.access = dependencies.access;
    this.validator = dependencies.validator;
    this.numbering = dependencies.numbering;
    this.history = dependencies.history;
    this.cache = dependencies.cache;
  }

  /**
   * Moves a work item with its descendants to another project.
   *
   * @remarks
   * The internal id stays stable while every moved item receives a new
   * project-specific key. Project-bound relations that cannot travel
   * (parent outside the target, milestones, labels, GitHub links, and
   * ineligible assignees) are cleared and recorded in the history.
   *
   * @param actor - User moving the ticket; must hold write permission twice.
   * @param id - Work item starting the moved subtree.
   * @param targetProjectId - Project receiving the ticket.
   * @returns The moved top-level work item with its new key.
   */
  public async moveToProject(
    actor: User,
    id: string,
    targetProjectId: string,
  ): Promise<WorkItemDetail> {
    const existing = await this.access.requireWorkItem(actor, id);
    const targetProject = await this.access.requireProject(
      actor,
      targetProjectId,
    );

    await this.access.requireWriteAccess(actor, existing.projectId);
    await this.access.requireWriteAccess(actor, targetProjectId);

    if (existing.projectId === targetProjectId) {
      throw new WorkItemValidationError(
        "The ticket already belongs to the selected project.",
      );
    }

    const subtree = await this.collectSubtree(actor, existing.id);

    // Renumbering the subtree must not interleave with other requests that
    // allocate numbers in the target project.
    await this.numbering.run(targetProject, async (sequence) => {
      await this.moveSubtree(actor, { subtree, targetProject }, sequence);
    });

    this.cache.invalidateWorkItems();
    this.cache.invalidateLabels();

    const moved = await this.taskRepository.findById(
      existing.id,
      await this.access.visibility(actor),
    );

    if (!moved) {
      throw new Error("Moved work item could not be retrieved.");
    }

    return moved;
  }

  private async collectSubtree(
    actor: User,
    rootId: string,
  ): Promise<WorkItemDetail[]> {
    const root = await this.taskRepository.findById(rootId);

    if (!root) {
      throw new WorkItemNotFoundError();
    }

    const collected: WorkItemDetail[] = [root];
    const queue: WorkItemDetail[] = [root];
    let current: WorkItemDetail | undefined;

    while ((current = queue.pop()) !== undefined) {
      const children = await this.taskRepository.findSubtasks(current.id);

      for (const child of children) {
        await this.access.requireWorkItem(actor, child.id);
        collected.push(child);
        queue.push(child);
      }
    }

    return collected;
  }

  private async moveSubtree(
    actor: User,
    move: SubtreeMove,
    sequence: KeySequence,
  ): Promise<void> {
    for (const [index, item] of move.subtree.entries()) {
      const number = sequence.firstNumber + index;

      await this.moveItem(actor, item, move, {
        key: `${sequence.projectKey}-${number}`,
        number,
      });
    }
  }

  private async moveItem(
    actor: User,
    item: WorkItemDetail,
    move: SubtreeMove,
    placement: ItemPlacement,
  ): Promise<void> {
    const { subtree, targetProject } = move;
    const keepParent =
      item.parentId !== null &&
      subtree.some((candidate) => candidate.id === item.parentId);
    const keepMilestone = await this.isMilestoneOfProject(
      item.milestoneId,
      targetProject.id,
    );
    const keepAssignee = item.assigneeId
      ? await this.validator.isEligibleAssignee(
          item.assigneeId,
          targetProject.id,
        )
      : false;

    await this.taskRepository.moveToProject(item.id, {
      assigneeId: keepAssignee ? item.assigneeId : null,
      key: placement.key,
      milestoneId: keepMilestone ? item.milestoneId : null,
      number: placement.number,
      parentId: keepParent ? item.parentId : null,
      projectId: targetProject.id,
    });
    await this.taskRepository.removeAllLabelsFromWorkItem(item.id);
    await this.history.recordProjectMove(actor, item, targetProject.name);
  }

  private async isMilestoneOfProject(
    milestoneId: string | null,
    projectId: string,
  ): Promise<boolean> {
    if (!milestoneId) {
      return false;
    }

    const milestone = await this.taskRepository.findMilestoneById(milestoneId);

    return milestone !== null && milestone.projectId === projectId;
  }
}
