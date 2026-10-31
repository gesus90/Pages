import { snapshotParameters } from "./WorkItemSnapshotSql";

import type { TaskDatabase } from "./TaskDatabase";
import type { WorkItemPriority, WorkItemType } from "@/definition/Task";
import type { TaskUpdateSnapshot } from "@/definition/TaskUpdateSnapshot";

/** Values required to persist a new work item. */
export interface NewWorkItem {
  readonly id: string;
  readonly projectId: string;
  readonly departmentId: string | null;
  readonly key: string;
  readonly number: number;
  readonly type: WorkItemType;
  readonly parentId: string | null;
  readonly title: string;
  readonly description: string;
  readonly statusId: string;
  readonly priority: WorkItemPriority;
  readonly assigneeId: string | null;
  readonly assigneeGroupId: string | null;
  readonly createdBy: string;
  readonly milestoneId: string | null;
  readonly dueAt: string | null;
  readonly startAt: string | null;
  readonly sortOrder: number;
}

/** Values that can be updated on an existing work item. */
export interface WorkItemUpdate {
  readonly title: string;
  readonly description: string;
  /** Leaves the stored description untouched, including concurrent saves. */
  readonly shouldPreserveDescription?: boolean;
  /** When present, the description must still match this text or the new text. */
  readonly baseDescription?: string;
  /** Editable fields to compare in the same statement as the update. */
  readonly expected?: TaskUpdateSnapshot;
  readonly statusId: string;
  readonly priority: WorkItemPriority;
  readonly assigneeId: string | null;
  readonly assigneeGroupId: string | null;
  readonly reporterId: string;
  readonly parentId: string | null;
  readonly milestoneId: string | null;
  readonly dueAt: string | null;
  readonly startAt: string | null;
}

/** GitHub linkage stored on a work item after synchronization. */
export interface WorkItemGitHubLink {
  readonly issueNumber: number | null;
  readonly issueUrl: string | null;
  readonly issueState: "open" | "closed" | null;
  readonly issueUpdatedAt: string | null;
  readonly contentHash: string | null;
  readonly conflict: boolean;
  readonly lastSyncAt: string | null;
}

/** Owns the write access to work items. */
export class WorkItemWriteRepository {
  private readonly database: TaskDatabase;

  /**
   * Creates a work item write repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: TaskDatabase) {
    this.database = database;
  }

  /** Replaces the GitHub linkage stored on a work item. */
  public async updateGitHubLink(
    id: string,
    link: WorkItemGitHubLink,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE work_items
        SET
            github_issue_number = $github_issue_number,
            github_issue_url = $github_issue_url,
            github_issue_state = $github_issue_state,
            github_issue_updated_at = $github_issue_updated_at,
            github_content_hash = $github_content_hash,
            github_conflict = $github_conflict,
            github_last_sync_at = $github_last_sync_at,
            updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      {
        id,
        github_issue_number: link.issueNumber,
        github_issue_url: link.issueUrl,
        github_issue_state: link.issueState,
        github_issue_updated_at: link.issueUpdatedAt,
        github_content_hash: link.contentHash,
        github_conflict: link.conflict ? 1 : 0,
        github_last_sync_at: link.lastSyncAt,
      },
    );
  }

  /** Sets or clears the synchronization conflict flag on a work item. */
  public async setGitHubConflict(id: string, conflict: boolean): Promise<void> {
    await this.database.execute(
      `
        UPDATE work_items
        SET
            github_conflict = $github_conflict,
            updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      { id, github_conflict: conflict ? 1 : 0 },
    );
  }

  /** Stores or clears the last GitHub synchronization error of a work item. */
  public async setGitHubError(
    id: string,
    message: string | null,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE work_items
        SET
            github_last_error = $github_last_error,
            updated_at = utc_now()
        WHERE id = $id;
      `,
      { id, github_last_error: message },
    );
  }

  /** Inserts a new work item. */
  public async insert(item: NewWorkItem): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO work_items (
            id,
            project_id,
            department_id,
            key,
            number,
            type,
            parent_id,
            title,
            description,
            status_id,
            priority,
            assignee_id,
            assignee_group_id,
            created_by,
            milestone_id,
            due_at,
            start_at,
            sort_order,
            created_at,
            updated_at
        )
        VALUES (
            $id,
            $project_id,
            $department_id,
            $key,
            $number,
            $type,
            $parent_id,
            $title,
            $description,
            $status_id,
            $priority,
            $assignee_id,
            $assignee_group_id,
            $created_by,
            $milestone_id,
            $due_at,
            $start_at,
            $sort_order,
            utc_now(),
            utc_now()
        );
      `,
      {
        assignee_group_id: item.assigneeGroupId,
        assignee_id: item.assigneeId,
        created_by: item.createdBy,
        department_id: item.departmentId,
        description: item.description,
        due_at: item.dueAt,
        id: item.id,
        key: item.key,
        milestone_id: item.milestoneId,
        number: item.number,
        parent_id: item.parentId,
        priority: item.priority,
        project_id: item.projectId,
        sort_order: item.sortOrder,
        start_at: item.startAt,
        status_id: item.statusId,
        title: item.title,
        type: item.type,
      },
    );
  }

  /** Updates fields atomically; returns false when inactive or the description changed meanwhile. */
  public async update(id: string, update: WorkItemUpdate): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE work_items
        SET
            title = $title,
            description = COALESCE($description, description),
            status_id = $status_id,
            priority = $priority,
            assignee_id = $assignee_id,
            assignee_group_id = $assignee_group_id,
            created_by = $created_by,
            parent_id = $parent_id,
            milestone_id = $milestone_id,
            due_at = $due_at,
            start_at = $start_at,
            updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL
            AND (
                NOT $has_expected
                OR (
                    title = $base_title
                    AND status_id = $base_status_id
                    AND priority = $base_priority
                    AND assignee_id IS NOT DISTINCT FROM $base_assignee_id
                    AND assignee_group_id IS NOT DISTINCT FROM $base_assignee_group_id
                    AND created_by = $base_reporter_id
                    AND parent_id IS NOT DISTINCT FROM $base_parent_id
                    AND milestone_id IS NOT DISTINCT FROM $base_milestone_id
                    AND due_at IS NOT DISTINCT FROM $base_due_at
                    AND start_at IS NOT DISTINCT FROM $base_start_at
                )
            )
            AND (
                $description IS NULL
                OR $base_description IS NULL
                OR description = $base_description
                OR description = $description
            )
        RETURNING id;
      `,
      {
        assignee_group_id: update.assigneeGroupId,
        assignee_id: update.assigneeId,
        created_by: update.reporterId,
        base_description: update.baseDescription ?? null,
        ...snapshotParameters(update.expected),
        description: update.shouldPreserveDescription
          ? null
          : update.description,
        due_at: update.dueAt,
        id,
        milestone_id: update.milestoneId,
        parent_id: update.parentId,
        priority: update.priority,
        start_at: update.startAt,
        status_id: update.statusId,
        title: update.title,
      },
    );

    return rows.length > 0;
  }

  /** Replaces a current description atomically; returns false when inactive or changed meanwhile. */
  public async updateDescription(
    id: string,
    description: string,
    baseDescription: string,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE work_items
        SET
            description = $description,
            updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL
            AND (description = $base_description OR description = $description)
        RETURNING id;
      `,
      { base_description: baseDescription, description, id },
    );

    return rows.length > 0;
  }

  /** Replaces a title atomically; returns false when inactive or no longer the base title. */
  public async updateTitle(
    id: string,
    title: string,
    baseTitle: string,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE work_items
        SET
            title = $title,
            updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL
            AND title = $base_title
        RETURNING id;
      `,
      { base_title: baseTitle, id, title },
    );

    return rows.length > 0;
  }

  /**
   * Replaces the status atomically and keeps the sort order; returns false
   * when inactive or no longer in the base status.
   */
  public async updateStatus(
    id: string,
    status: { readonly id: string; readonly isDone: boolean },
    baseStatusId: string,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE work_items
        SET
            status_id = $status_id,
            completed_at = CASE WHEN $is_done = 1 THEN utc_now() ELSE NULL END,
            updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL
            AND status_id = $base_status_id
        RETURNING id;
      `,
      {
        base_status_id: baseStatusId,
        id,
        is_done: status.isDone ? 1 : 0,
        status_id: status.id,
      },
    );

    return rows.length > 0;
  }

  /** Replaces the parent atomically; returns false when inactive or no longer below the base parent. */
  public async replaceParent(
    id: string,
    parentId: string | null,
    baseParentId: string | null,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE work_items
        SET
            parent_id = $parent_id,
            updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL
            AND (
                parent_id = $base_parent_id
                OR ($base_parent_id IS NULL AND parent_id IS NULL)
            )
        RETURNING id;
      `,
      { base_parent_id: baseParentId, id, parent_id: parentId },
    );

    return rows.length > 0;
  }

  /** Sets the parent of an active work item, or removes it with `null`. */
  public async updateParent(
    id: string,
    parentId: string | null,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE work_items
        SET
            parent_id = $parent_id,
            updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      { id, parent_id: parentId },
    );
  }

  /** Assigns a work item to a department, or clears the assignment with `null`. */
  public async setDepartment(
    id: string,
    departmentId: string | null,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE work_items
        SET
            department_id = $department_id,
            updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      { department_id: departmentId, id },
    );
  }

  /** Changes the department only while the displayed assignment is current. */
  public async setDepartmentIfCurrent(
    id: string,
    departmentId: string | null,
    expected: string | null,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE work_items
        SET department_id = $department_id, updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL
            AND department_id IS NOT DISTINCT FROM $expected
        RETURNING id;
      `,
      { department_id: departmentId, expected, id },
    );
    return rows.length > 0;
  }

  /** Writes GitHub's synchronized fields while preserving all local relationships. */
  public async updateFromGitHub(
    id: string,
    update: Pick<WorkItemUpdate, "title" | "description" | "statusId">,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE work_items
      SET
          title = $title,
          description = $description,
          status_id = $status_id,
          updated_at = utc_now()
      WHERE id = $id
          AND archived_at IS NULL;
    `,
      {
        id,
        title: update.title,
        description: update.description,
        status_id: update.statusId,
      },
    );
  }

  /** Updates the workflow status, ordering, and completion timestamp of a work item. */
  public async updateStatusAndOrder(
    id: string,
    statusId: string,
    sortOrder: number,
    isDone: boolean,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE work_items
        SET
            status_id = $status_id,
            sort_order = $sort_order,
            completed_at = CASE WHEN $is_done = 1 THEN utc_now() ELSE NULL END,
            updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      {
        id,
        is_done: isDone ? 1 : 0,
        sort_order: sortOrder,
        status_id: statusId,
      },
    );
  }
}
