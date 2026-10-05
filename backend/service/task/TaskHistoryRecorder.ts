import { randomUUID } from "node:crypto";

import type {
  NewWorkItemHistory,
  TaskRepository,
} from "@/backend/database/repositories/TaskRepository";
import type {
  WorkItemDetail,
  WorkItemPriority,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";

/** The values a work item update stores, as the history compares them. */
export interface WorkItemUpdateValues {
  readonly title: string;
  readonly description: string;
  readonly priority: WorkItemPriority;
  readonly newStatus: WorkflowStatus;
  readonly assigneeId: string | null;
  readonly reporterId: string;
  readonly parentId: string | null;
  readonly milestoneId: string | null;
  readonly dueAt: string | null;
  readonly startAt: string | null;
}

/** One change of a work item, before it is attributed to a user. */
type HistoryChange = Pick<
  NewWorkItemHistory,
  "action" | "field" | "oldValue" | "newValue"
>;

function plainChange(action: string): HistoryChange {
  return { action, field: null, newValue: null, oldValue: null };
}

function describeStatusChange(
  existing: WorkItemDetail,
  newStatus: WorkflowStatus,
): HistoryChange {
  return {
    action: "status_changed",
    field: "status",
    newValue: newStatus.name,
    oldValue: existing.statusName,
  };
}

function changedBasics(
  existing: WorkItemDetail,
  update: WorkItemUpdateValues,
): HistoryChange[] {
  const changes: HistoryChange[] = [];

  if (existing.title !== update.title) {
    changes.push({
      action: "title_changed",
      field: "title",
      newValue: update.title,
      oldValue: existing.title,
    });
  }

  if (existing.description !== update.description) {
    changes.push({
      action: "description_changed",
      field: "description",
      newValue: update.description,
      oldValue: existing.description,
    });
  }

  if (existing.statusId !== update.newStatus.id) {
    changes.push(describeStatusChange(existing, update.newStatus));
  }

  if (existing.priority !== update.priority) {
    changes.push({
      action: "priority_changed",
      field: "priority",
      newValue: update.priority,
      oldValue: existing.priority,
    });
  }

  return changes;
}

function changedDates(
  existing: WorkItemDetail,
  update: WorkItemUpdateValues,
): HistoryChange[] {
  if (existing.dueAt === update.dueAt) {
    return [];
  }

  return [
    {
      action: "due_at_changed",
      field: "due_at",
      newValue: update.dueAt,
      oldValue: existing.dueAt,
    },
  ];
}

/** Records the audit trail of work items. */
export class TaskHistoryRecorder {
  private readonly taskRepository: TaskRepository;

  /**
   * Creates a history recorder.
   *
   * @param taskRepository - Task persistence boundary holding the history.
   */
  public constructor(taskRepository: TaskRepository) {
    this.taskRepository = taskRepository;
  }

  /** Records that a work item was created. */
  public async recordCreated(actor: User, workItemId: string): Promise<void> {
    await this.record(actor, workItemId, plainChange("created"));
  }

  /** Records that a work item was archived. */
  public async recordArchived(actor: User, workItemId: string): Promise<void> {
    await this.record(actor, workItemId, plainChange("archived"));
  }

  /** Records that an archived work item was restored. */
  public async recordRestored(actor: User, workItemId: string): Promise<void> {
    await this.record(actor, workItemId, plainChange("restored"));
  }

  /** Records a status move, unless the work item already had the status. */
  public async recordStatusMove(
    actor: User,
    existing: WorkItemDetail,
    status: WorkflowStatus,
  ): Promise<void> {
    if (existing.statusId === status.id) {
      return;
    }

    await this.record(
      actor,
      existing.id,
      describeStatusChange(existing, status),
    );
  }

  /** Records that a label was added to a work item. */
  public async recordLabelAdded(
    actor: User,
    workItemId: string,
    labelName: string,
  ): Promise<void> {
    await this.record(actor, workItemId, {
      action: "label_added",
      field: "label",
      newValue: labelName,
      oldValue: null,
    });
  }

  /** Records that a label was removed from a work item. */
  public async recordLabelRemoved(
    actor: User,
    workItemId: string,
    labelName: string | null,
  ): Promise<void> {
    await this.record(actor, workItemId, {
      action: "label_removed",
      field: "label",
      newValue: null,
      oldValue: labelName,
    });
  }

  /**
   * Records that a work item moved to another project.
   *
   * @remarks
   * A GitHub issue cannot travel to another project, so its unlinking is
   * recorded as well.
   */
  public async recordProjectMove(
    actor: User,
    item: WorkItemDetail,
    targetProjectName: string,
  ): Promise<void> {
    await this.record(actor, item.id, {
      action: "project_changed",
      field: "project",
      newValue: targetProjectName,
      oldValue: item.projectName,
    });

    if (item.githubIssueNumber !== null) {
      await this.record(actor, item.id, {
        action: "github_unlinked",
        field: "github",
        newValue: null,
        oldValue: `#${item.githubIssueNumber}`,
      });
    }
  }

  /** Records that publishing a work item to GitHub failed. */
  public async recordGitHubSyncFailed(
    actor: User,
    workItemId: string,
    message: string,
  ): Promise<void> {
    await this.record(actor, workItemId, {
      action: "github_sync_failed",
      field: "github",
      newValue: message,
      oldValue: null,
    });
  }

  /** Records one entry for every field an update changed. */
  public async recordUpdate(
    actor: User,
    existing: WorkItemDetail,
    update: WorkItemUpdateValues,
  ): Promise<void> {
    const changes = [
      ...changedBasics(existing, update),
      ...(await this.changedReferences(existing, update)),
      ...changedDates(existing, update),
    ];

    for (const change of changes) {
      await this.record(actor, existing.id, change);
    }
  }

  /**
   * Finds the changes of fields that point to other records, such as people,
   * the parent and the milestone, with the names the history shows.
   */
  private async changedReferences(
    existing: WorkItemDetail,
    update: WorkItemUpdateValues,
  ): Promise<HistoryChange[]> {
    const changes: HistoryChange[] = [];

    if (existing.assigneeId !== update.assigneeId) {
      changes.push({
        action: "assignee_changed",
        field: "assignee",
        newValue: await this.findPersonName(
          existing.projectId,
          update.assigneeId,
        ),
        oldValue: existing.assigneeName,
      });
    }

    if (existing.createdBy !== update.reporterId) {
      changes.push({
        action: "reporter_changed",
        field: "reporter",
        newValue: await this.findPersonName(
          existing.projectId,
          update.reporterId,
        ),
        oldValue: existing.reporterName,
      });
    }

    if (existing.parentId !== update.parentId) {
      const parent = update.parentId
        ? await this.taskRepository.findById(update.parentId)
        : null;

      changes.push({
        action: "parent_changed",
        field: "parent",
        newValue: parent?.key ?? null,
        oldValue: existing.parentKey,
      });
    }

    if (existing.milestoneId !== update.milestoneId) {
      const milestone = update.milestoneId
        ? await this.taskRepository.findMilestoneById(update.milestoneId)
        : null;

      changes.push({
        action: "milestone_changed",
        field: "milestone",
        newValue: milestone?.name ?? null,
        oldValue: existing.milestoneName,
      });
    }

    return changes;
  }

  private async findPersonName(
    projectId: string,
    userId: string | null,
  ): Promise<string | null> {
    const eligibleUsers =
      await this.taskRepository.findEligibleAssignees(projectId);

    return (
      eligibleUsers.find((user) => user.id === userId)?.displayName ?? null
    );
  }

  private async record(
    actor: User,
    workItemId: string,
    change: HistoryChange,
  ): Promise<void> {
    await this.taskRepository.insertHistory({
      ...change,
      id: randomUUID(),
      userId: actor.id,
      workItemId,
    });
  }
}
