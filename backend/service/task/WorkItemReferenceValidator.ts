import { WorkItemValidationError } from "@/backend/error/WorkItemErrors";
import {
  assertParentActive,
  assertParentFits,
  selectParentLookup,
} from "@/backend/service/task/WorkItemHierarchy";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import type { WorkItemType, WorkItemVisibility } from "@/definition/Task";
import type { TaskAccessGuard } from "./TaskAccessGuard";

/** The parent a work item points to, which must exist, fit its type and be active. */
export interface ParentReference {
  readonly type: WorkItemType;
  readonly visibility?: WorkItemVisibility;
  /** Trusted unchanged hidden parent; never taken from external input. */
  readonly preservedParentId?: string | null;
  /**
   * The parent the work item has now. It may stay even when it was archived
   * meanwhile; only a newly chosen parent must be active.
   */
  readonly storedParentId?: string | null;
  readonly projectId: string;
  readonly selfId: string | null;
  readonly parentId: string | null;
}

/** The records a work item points to, which must exist and fit its project. */
export interface WorkItemReferences extends ParentReference {
  readonly milestoneId: string | null;
  readonly assigneeId: string | null;
  readonly assigneeGroupId: string | null;
  /** Trusted unchanged group of the stored ticket; it may have lost its members since. */
  readonly preservedGroupId?: string | null;
}

/** Checks that the parent, milestone and assignee of a work item are usable. */
export class WorkItemReferenceValidator {
  private readonly taskRepository: TaskRepository;
  private readonly access: TaskAccessGuard;

  /**
   * Creates a reference validator.
   *
   * @param taskRepository - Task persistence boundary.
   * @param access - Current project access used to validate assignment candidates.
   */
  public constructor(taskRepository: TaskRepository, access: TaskAccessGuard) {
    this.taskRepository = taskRepository;
    this.access = access;
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

    await this.validateAssignment(references);
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
      throw new WorkItemValidationError("assigneeNoProjectAccess");
    }
  }

  /** Tells whether a person has access to a project and may be assigned. */
  public async isEligibleAssignee(
    userId: string,
    projectId: string,
  ): Promise<boolean> {
    const candidates = await this.taskRepository.findEligibleAssignees();
    const eligible = await this.access.filterAssignees(
      new Map([[projectId, candidates]]),
    );
    return (eligible.get(projectId) ?? []).some((user) => user.id === userId);
  }

  /**
   * Validates the parent of a work item against the hierarchy.
   *
   * @throws {WorkItemHierarchyError} When the parent is missing, hidden, of
   * the wrong type, in another project, or newly chosen and archived.
   */
  public async validateHierarchy(reference: ParentReference): Promise<void> {
    const lookup = selectParentLookup(
      reference.type,
      reference.parentId,
      reference.selfId,
    );

    if (lookup === null) {
      return;
    }

    if (reference.preservedParentId === lookup.parentId) return;
    const parent = await this.taskRepository.findById(
      lookup.parentId,
      reference.visibility,
    );

    assertParentFits(parent, lookup.rule, reference.projectId);

    if (reference.storedParentId !== lookup.parentId) {
      assertParentActive(parent);
    }
  }

  private async validateAssignment(
    references: WorkItemReferences,
  ): Promise<void> {
    if (references.assigneeId && references.assigneeGroupId) {
      throw new WorkItemValidationError("assigneeAndGroup");
    }

    if (references.assigneeId) {
      await this.validateAssignee(references.assigneeId, references.projectId);
    }

    if (
      references.assigneeGroupId &&
      references.assigneeGroupId !== references.preservedGroupId
    ) {
      await this.validateGroup(references.assigneeGroupId);
    }
  }

  private async validateGroup(groupId: string): Promise<void> {
    const group = await this.taskRepository.findAssigneeGroupById(groupId);

    if (!group) {
      throw new WorkItemValidationError("groupNotFound");
    }

    // Group members need no project access (accepted special case); an empty
    // group would leave the ticket without anyone responsible.
    if (group.memberCount === 0) {
      throw new WorkItemValidationError("groupEmpty");
    }
  }

  private async validateMilestone(
    milestoneId: string,
    projectId: string,
  ): Promise<void> {
    const milestone = await this.taskRepository.findMilestoneById(milestoneId);

    if (!milestone) {
      throw new WorkItemValidationError("milestoneNotFound");
    }

    if (milestone.projectId !== projectId) {
      throw new WorkItemValidationError("milestoneOtherProject");
    }
  }
}
