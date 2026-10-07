import type { Database } from "@/backend/database/Database";
import type { WorkItemPriority, WorkItemType } from "@/definition/Task";

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

/** Target of moving a work item to another project. */
export interface WorkItemMove {
  readonly projectId: string;
  readonly key: string;
  readonly number: number;
  readonly parentId: string | null;
  readonly milestoneId: string | null;
  readonly assigneeId: string | null;
}

/** Owns the write access to work items. */
export class WorkItemWriteRepository {
  private readonly database: Database;

  /**
   * Creates a work item write repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
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

  /** Updates fields on an existing work item. */
  public async update(id: string, update: WorkItemUpdate): Promise<void> {
    await this.database.execute(
      `
        UPDATE work_items
        SET
            title = $title,
            description = $description,
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
            AND archived_at IS NULL;
      `,
      {
        assignee_group_id: update.assigneeGroupId,
        assignee_id: update.assigneeId,
        created_by: update.reporterId,
        description: update.description,
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

  /**
   * Moves a work item to another project with a new project-specific key.
   * Project-bound relations travel in the `move` mapping while the
   * GitHub linkage is cleared because integrations belong to projects.
   *
   * @param id - Work item kept under its stable internal identifier.
   * @param move - Target project, new key, and cleared project-bound relations.
   */
  public async moveToProject(id: string, move: WorkItemMove): Promise<void> {
    await this.database.execute(
      `
        UPDATE work_items
        SET
            project_id = $project_id,
            key = $key,
            number = $number,
            parent_id = $parent_id,
            milestone_id = $milestone_id,
            assignee_id = $assignee_id,
            github_issue_number = NULL,
            github_issue_url = NULL,
            github_issue_state = NULL,
            github_issue_updated_at = NULL,
            github_content_hash = NULL,
            github_conflict = 0,
            github_last_sync_at = NULL,
            github_last_error = NULL,
            updated_at = utc_now()
        WHERE id = $id;
      `,
      {
        assignee_id: move.assigneeId,
        id,
        key: move.key,
        milestone_id: move.milestoneId,
        number: move.number,
        parent_id: move.parentId,
        project_id: move.projectId,
      },
    );
  }
}
