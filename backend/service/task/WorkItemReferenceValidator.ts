import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import {
  assertParentFits,
  selectParentLookup,
} from "@/backend/service/task/WorkItemHierarchy";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { WorkItemType } from "@/definition/Task";

/** The records a work item points to, which must exist and fit its project. */
export interface WorkItemReferences {
  readonly type: WorkItemType;
  readonly projectId: string;
  readonly selfId: string | null;
  readonly parentId: string | null;
  readonly milestoneId: string | null;
  readonly assigneeId: string | null;
}

/** Checks that the parent, milestone and assignee of a work item are usable. */
export class WorkItemReferenceValidator {
  private readonly taskRepository: TaskRepository;

  /**
   * Creates a reference validator.
   *
   * @param taskRepository - Task persistence boundary.
   */
  public constructor(taskRepository: TaskRepository) {
    this.taskRepository = taskRepository;
  }

  /**
   * Validates hierarchy, milestone and assignee of a work item in this order.
   *
   * @throws {WorkItemHierarchyError} When the parent violates the hierarchy.
   * @throws {WorkItemValidationError} When the milestone or assignee does not fit the project.
   */
  public async validateReferences(
    references: WorkItemReferences,
  ): Promise<void> {
    await this.validateHierarchy(references);

    if (references.milestoneId) {
      await this.validateMilestone(
        references.milestoneId,
        references.projectId,
      );
    }

    if (references.assigneeId) {
      await this.validateAssignee(references.assigneeId, references.projectId);
    }
  }

  /**
   * Validates that a person may be assigned within a project.
   *
   * @throws {WorkItemValidationError} When the person has no access to the project.
   */
  public async validateAssignee(
    userId: string,
    projectId: string,
  ): Promise<void> {
    if (!(await this.isEligibleAssignee(userId, projectId))) {
      throw new WorkItemValidationError(
        "Selected assignee does not have access to this project.",
      );
    }
  }

  /** Tells whether a person has access to a project and may be assigned. */
  public async isEligibleAssignee(
    userId: string,
    projectId: string,
  ): Promise<boolean> {
    const eligible = await this.taskRepository.findEligibleAssignees(projectId);

    return eligible.some((user) => user.id === userId);
  }

  private async validateHierarchy(
    references: WorkItemReferences,
  ): Promise<void> {
    const lookup = selectParentLookup(
      references.type,
      references.parentId,
      references.selfId,
    );

    if (lookup === null) {
      return;
    }

    const parent = await this.taskRepository.findById(lookup.parentId);

    assertParentFits(parent, lookup.rule, references.projectId);
  }

  private async validateMilestone(
    milestoneId: string,
    projectId: string,
  ): Promise<void> {
    const milestone = await this.taskRepository.findMilestoneById(milestoneId);

    if (!milestone) {
      throw new WorkItemValidationError("Selected milestone does not exist.");
    }

    if (milestone.projectId !== projectId) {
      throw new WorkItemValidationError(
        "Milestone does not belong to the selected project.",
      );
    }
  }
}
