import {
  readBooleanColumn,
  readCountColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { isRole } from "@/definition/Role";
import {
  isGitHubIssueState,
  isWorkItemLinkType,
  isWorkItemPriority,
  isWorkItemType,
} from "@/definition/Task";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type {
  Milestone,
  ProjectLabel,
  WorkItemChecklistItem,
  WorkItemDetail,
  WorkItemHistory,
  WorkItemLink,
  WorkItemLinkType,
  WorkItemPriority,
  WorkItemType,
  WorkflowStatus,
} from "@/definition/Task";
import type { User } from "@/definition/User";

/** Values required to persist a milestone. */
export interface NewMilestone {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string;
  readonly dueAt: string | null;
}

/** Values that can be changed on a milestone. */
export interface MilestoneUpdate {
  readonly name: string;
  readonly description: string;
  readonly status: "open" | "completed" | "archived";
  readonly dueAt: string | null;
}

/** Values required to persist a new work item. */
export interface NewWorkItem {
  readonly id: string;
  readonly projectId: string;
  readonly key: string;
  readonly number: number;
  readonly type: WorkItemType;
  readonly parentId: string | null;
  readonly title: string;
  readonly description: string;
  readonly statusId: string;
  readonly priority: WorkItemPriority;
  readonly assigneeId: string | null;
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

/** Entry to record in the audit trail. */
export interface NewWorkItemHistory {
  readonly id: string;
  readonly workItemId: string;
  readonly userId: string;
  readonly action: string;
  readonly field: string | null;
  readonly oldValue: string | null;
  readonly newValue: string | null;
}

/** Sort orders supported when querying work items. */
export type WorkItemsOrder =
  "board" | "updated_desc" | "due_asc" | "due_nulls_last";

/** Optional filters for querying work items. */
export interface FindWorkItemsOptions {
  readonly projectIds?: readonly string[];
  readonly assigneeId?: string;
  readonly type?: WorkItemType;
  readonly statusId?: string;
  readonly priority?: WorkItemPriority;
  readonly milestoneId?: string;
  readonly search?: string;
  readonly archived?: "active" | "archived" | "all";
  readonly openOnly?: boolean;
  readonly hasDueDate?: boolean;
  readonly orderBy?: WorkItemsOrder;
  readonly limit?: number;
}

/** Dashboard counters computed directly in SQLite. */
export interface WorkItemsOverview {
  readonly open: number;
  readonly overdue: number;
  readonly inProgress: number;
  readonly assigned: number;
  readonly openDelta: number;
  readonly overdueDelta: number;
}

/** Per-project done/total counters computed directly in SQLite. */
export interface ProjectWorkItemCounts {
  readonly done: number;
  readonly total: number;
}

/**
 * Maps a supported sort order to its ORDER BY fragment.
 *
 * @remarks
 * The fragment comes from a fixed whitelist so callers can never inject
 * arbitrary SQL through the order option.
 */
function getWorkItemsOrderClause(order: WorkItemsOrder): string {
  switch (order) {
    case "updated_desc":
      return "ORDER BY work_items.updated_at DESC";
    case "due_asc":
      return "ORDER BY work_items.due_at ASC";
    case "due_nulls_last":
      return "ORDER BY work_items.due_at IS NULL ASC, work_items.due_at ASC, work_items.updated_at DESC";
    case "board":
      return "ORDER BY work_items.sort_order ASC, work_items.created_at DESC";
  }
}

/** Establishes the persistence boundary for tasks, statuses, milestones, and audit records. */
export class TaskRepository {
  private readonly database: Database;

  /**
   * Creates a task repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Returns all workflow statuses ordered by position. */
  public async findAllStatuses(): Promise<WorkflowStatus[]> {
    const rows = await this.database.query(`
      SELECT
          id,
          project_id,
          key,
          name,
          position,
          is_done
      FROM workflow_statuses
      ORDER BY position ASC;
    `);

    return rows.map((row) => this.toWorkflowStatus(row));
  }

  /** Returns a workflow status by its identifier. */
  public async findStatusById(id: string): Promise<WorkflowStatus | null> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            key,
            name,
            position,
            is_done
        FROM workflow_statuses
        WHERE id = $id;
      `,
      { id },
    );
    const row = rows[0];

    return row ? this.toWorkflowStatus(row) : null;
  }

  /** Returns all non-archived milestones for the given projects. */
  public async findMilestonesByProjectIds(
    projectIds: readonly string[],
  ): Promise<Milestone[]> {
    if (projectIds.length === 0) {
      return [];
    }

    const placeholders = projectIds
      .map((_, index) => `$project_id_${index}`)
      .join(", ");
    const parameters: Record<string, string> = {};

    for (const [index, projectId] of projectIds.entries()) {
      parameters[`project_id_${index}`] = projectId;
    }

    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            name,
            COALESCE(description, ''),
            status,
            start_at,
            due_at,
            created_at,
            updated_at,
            completed_at,
            archived_at
        FROM milestones
        WHERE project_id IN (${placeholders})
            AND archived_at IS NULL
        ORDER BY due_at ASC, name ASC;
      `,
      parameters,
    );

    return rows.map((row) => this.toMilestone(row));
  }

  /** Returns a milestone by its identifier. */
  public async findMilestoneById(id: string): Promise<Milestone | null> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            name,
            COALESCE(description, ''),
            status,
            start_at,
            due_at,
            created_at,
            updated_at,
            completed_at,
            archived_at
        FROM milestones
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      { id },
    );
    const row = rows[0];

    return row ? this.toMilestone(row) : null;
  }

  /** Inserts a milestone for the given project. */
  public async insertMilestone(milestone: NewMilestone): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO milestones (
            id,
            project_id,
            name,
            description,
            status,
            due_at,
            updated_at
        )
        VALUES (
            $id,
            $project_id,
            $name,
            $description,
            'open',
            $due_at,
            CURRENT_TIMESTAMP
        );
      `,
      {
        id: milestone.id,
        project_id: milestone.projectId,
        name: milestone.name,
        description: milestone.description,
        due_at: milestone.dueAt,
      },
    );
  }

  /** Updates the editable values of a milestone. */
  public async updateMilestone(
    id: string,
    milestone: MilestoneUpdate,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE milestones
        SET
            name = $name,
            description = $description,
            status = $status,
            due_at = $due_at,
            completed_at = CASE WHEN $status = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      {
        id,
        name: milestone.name,
        description: milestone.description,
        status: milestone.status,
        due_at: milestone.dueAt,
      },
    );
  }

  /** Returns work item history across all tasks of one project, newest last. */
  public async findHistoryByProjectId(
    projectId: string,
  ): Promise<WorkItemHistory[]> {
    const rows = await this.database.query(
      `
        SELECT
            work_item_history.id,
            work_item_history.work_item_id,
            work_item_history.user_id,
            users.display_name AS user_display_name,
            work_item_history.action,
            work_item_history.field,
            work_item_history.old_value,
            work_item_history.new_value,
            work_item_history.created_at
        FROM work_item_history
        INNER JOIN work_items
            ON work_items.id = work_item_history.work_item_id
        LEFT JOIN users
            ON users.id = work_item_history.user_id
        WHERE work_items.project_id = $project_id
        ORDER BY work_item_history.created_at DESC
        LIMIT 200;
      `,
      { project_id: projectId },
    );

    return rows.map((row) => this.toWorkItemHistory(row));
  }

  /** Returns the prefix key stored for a project or registers a newly generated one. */
  public async findOrCreateProjectKey(
    projectId: string,
    defaultKey: string,
  ): Promise<string> {
    const rows = await this.database.query(
      `
        SELECT
            key
        FROM project_keys
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );
    const row = rows[0];

    if (row) {
      return readTextColumn(row, 0, "key");
    }

    await this.database.execute(
      `
        INSERT INTO project_keys (
            project_id,
            key
        )
        VALUES (
            $project_id,
            $key
        )
        ON CONFLICT (project_id) DO NOTHING;
      `,
      { key: defaultKey, project_id: projectId },
    );

    const confirmationRows = await this.database.query(
      `
        SELECT
            key
        FROM project_keys
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );
    const confirmedRow = confirmationRows[0];

    if (!confirmedRow) {
      return defaultKey;
    }

    return readTextColumn(confirmedRow, 0, "key");
  }

  /** Returns the next sequential ticket number for the given project. */
  public async getNextNumber(projectId: string): Promise<number> {
    const rows = await this.database.query(
      `
        SELECT
            COALESCE(MAX(number), 0) + 1 AS next_number
        FROM work_items
        WHERE project_id = $project_id;
      `,
      { project_id: projectId },
    );
    const row = rows[0];

    if (!row) {
      return 1;
    }

    return readCountColumn(row, 0, "next_number");
  }

  /** Returns non-archived work items matching the given filters. */
  public async findAll(
    options: FindWorkItemsOptions = {},
  ): Promise<WorkItemDetail[]> {
    const archived = options.archived ?? "active";
    const conditions: string[] =
      archived === "all"
        ? []
        : archived === "archived"
          ? ["work_items.archived_at IS NOT NULL"]
          : ["work_items.archived_at IS NULL"];
    const parameters: Record<string, string | number> = {};

    if (options.projectIds) {
      if (options.projectIds.length === 0) {
        return [];
      }

      const placeholders = options.projectIds
        .map((_, index) => `$project_id_${index}`)
        .join(", ");

      for (const [index, projectId] of options.projectIds.entries()) {
        parameters[`project_id_${index}`] = projectId;
      }

      conditions.push(`work_items.project_id IN (${placeholders})`);
    }

    if (options.assigneeId) {
      conditions.push("work_items.assignee_id = $assignee_id");
      parameters.assignee_id = options.assigneeId;
    }

    if (options.type) {
      conditions.push("work_items.type = $type");
      parameters.type = options.type;
    }

    if (options.statusId) {
      conditions.push("work_items.status_id = $status_id");
      parameters.status_id = options.statusId;
    }

    if (options.priority) {
      conditions.push("work_items.priority = $priority");
      parameters.priority = options.priority;
    }

    if (options.milestoneId) {
      conditions.push("work_items.milestone_id = $milestone_id");
      parameters.milestone_id = options.milestoneId;
    }

    if (options.search && options.search.trim()) {
      conditions.push(
        "(LOWER(work_items.title) LIKE $search OR LOWER(work_items.key) LIKE $search)",
      );
      parameters.search = `%${options.search.trim().toLowerCase()}%`;
    }

    if (options.openOnly === true) {
      conditions.push("workflow_statuses.is_done = 0");
    }

    if (options.hasDueDate === true) {
      conditions.push("work_items.due_at IS NOT NULL");
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const orderClause = getWorkItemsOrderClause(options.orderBy ?? "board");
    const limitClause = options.limit === undefined ? "" : "LIMIT $limit;";
    const subtaskScope =
      options.projectIds && options.projectIds.length > 0
        ? `AND child.project_id IN (${options.projectIds
            .map((_, index) => `$project_id_${index}`)
            .join(", ")})`
        : "";

    if (options.limit !== undefined) {
      parameters.limit = options.limit;
    }

    const statement = `
      SELECT
          work_items.id,
          work_items.project_id,
          work_items.key,
          work_items.number,
          work_items.type,
          work_items.parent_id,
          work_items.title,
          work_items.description,
          work_items.status_id,
          work_items.priority,
          work_items.assignee_id,
          work_items.created_by,
          work_items.milestone_id,
          work_items.due_at,
          work_items.sort_order,
          work_items.created_at,
          work_items.updated_at,
          work_items.completed_at,
          work_items.archived_at,
          projects.name AS project_name,
          workflow_statuses.key AS status_key,
          workflow_statuses.name AS status_name,
          workflow_statuses.is_done AS is_done,
          assignee.display_name AS assignee_name,
          milestones.name AS milestone_name,
          parent.title AS parent_title,
          parent.key AS parent_key,
          COALESCE(subtasks.total, 0) AS subtask_total,
          COALESCE(subtasks.completed, 0) AS subtask_completed,
          work_items.github_issue_number,
          work_items.github_issue_url,
          work_items.github_issue_state,
          work_items.github_issue_updated_at,
          work_items.github_content_hash,
          work_items.github_conflict,
          work_items.github_last_sync_at,
          reporter.display_name AS reporter_name,
          work_items.start_at,
          work_items.github_last_error
      FROM work_items
      INNER JOIN projects
          ON projects.id = work_items.project_id
      INNER JOIN workflow_statuses
          ON workflow_statuses.id = work_items.status_id
      LEFT JOIN users AS assignee
          ON assignee.id = work_items.assignee_id
      LEFT JOIN users AS reporter
          ON reporter.id = work_items.created_by
      LEFT JOIN milestones
          ON milestones.id = work_items.milestone_id
      LEFT JOIN work_items AS parent
          ON parent.id = work_items.parent_id
      LEFT JOIN (
          SELECT
              child.parent_id,
              COUNT(*) AS total,
              SUM(CASE WHEN child_status.is_done = 1 THEN 1 ELSE 0 END) AS completed
          FROM work_items AS child
          INNER JOIN workflow_statuses AS child_status
              ON child_status.id = child.status_id
          WHERE child.archived_at IS NULL
          ${subtaskScope}
          GROUP BY child.parent_id
      ) AS subtasks
          ON subtasks.parent_id = work_items.id
      ${whereClause}
      ${orderClause}
      ${limitClause}
    `;

    const rows = await this.database.query(statement, parameters);

    return rows.map((row) => this.toWorkItemDetail(row));
  }

  /**
   * Returns dashboard counters for several projects with a single query.
   *
   * @param projectIds - Projects already verified as accessible to the actor.
   * @param scope - Actor id, day boundaries as UTC calendar dates
   * (`YYYY-MM-DD`, matching how the dashboard compares due dates), and a
   * full-precision lower bound for the seven-day delta.
   */
  public async countWorkItemsOverview(
    projectIds: readonly string[],
    scope: {
      readonly userId: string;
      readonly todayDate: string;
      readonly weekAgoStart: string;
      readonly yesterdayDate: string;
    },
  ): Promise<WorkItemsOverview> {
    const empty: WorkItemsOverview = {
      assigned: 0,
      inProgress: 0,
      open: 0,
      openDelta: 0,
      overdue: 0,
      overdueDelta: 0,
    };

    if (projectIds.length === 0) {
      return empty;
    }

    const placeholders = projectIds
      .map((_, index) => `$overview_project_id_${index}`)
      .join(", ");
    const parameters: Record<string, string> = {
      today_date: scope.todayDate,
      user_id: scope.userId,
      week_ago_start: scope.weekAgoStart,
      yesterday_date: scope.yesterdayDate,
    };

    for (const [index, projectId] of projectIds.entries()) {
      parameters[`overview_project_id_${index}`] = projectId;
    }

    const rows = await this.database.query(
      `
        SELECT
            COUNT(CASE WHEN statuses.is_done = 0 THEN 1 END) AS open_count,
            COUNT(CASE WHEN statuses.is_done = 0 AND work_items.due_at IS NOT NULL AND date(work_items.due_at) <= $today_date THEN 1 END) AS overdue_count,
            COUNT(CASE WHEN statuses.is_done = 0 AND statuses.key = 'in_progress' THEN 1 END) AS in_progress_count,
            COUNT(CASE WHEN statuses.is_done = 0 AND work_items.assignee_id = $user_id THEN 1 END) AS assigned_count,
            COUNT(CASE WHEN statuses.is_done = 0 AND work_items.created_at >= $week_ago_start THEN 1 END) AS open_delta_count,
            COUNT(CASE WHEN statuses.is_done = 0 AND work_items.due_at IS NOT NULL AND date(work_items.due_at) <= $today_date AND date(work_items.due_at) >= $yesterday_date THEN 1 END) AS overdue_delta_count
        FROM work_items
        INNER JOIN workflow_statuses AS statuses
            ON statuses.id = work_items.status_id
        WHERE work_items.project_id IN (${placeholders})
            AND work_items.archived_at IS NULL;
      `,
      parameters,
    );
    const row = rows[0];

    if (!row) {
      return empty;
    }

    return {
      assigned: readCountColumn(row, 3, "assigned_count"),
      inProgress: readCountColumn(row, 2, "in_progress_count"),
      open: readCountColumn(row, 0, "open_count"),
      openDelta: readCountColumn(row, 4, "open_delta_count"),
      overdue: readCountColumn(row, 1, "overdue_count"),
      overdueDelta: readCountColumn(row, 5, "overdue_delta_count"),
    };
  }

  /**
   * Returns done/total counters per project with a single query.
   *
   * @param projectIds - Projects already verified as accessible to the actor.
   */
  public async countWorkItemsByProject(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ProjectWorkItemCounts>> {
    const countsByProject = new Map<string, ProjectWorkItemCounts>();

    if (projectIds.length === 0) {
      return countsByProject;
    }

    const placeholders = projectIds
      .map((_, index) => `$counts_project_id_${index}`)
      .join(", ");
    const parameters: Record<string, string> = {};

    for (const [index, projectId] of projectIds.entries()) {
      parameters[`counts_project_id_${index}`] = projectId;
    }

    const rows = await this.database.query(
      `
        SELECT
            work_items.project_id,
            statuses.is_done AS is_done,
            COUNT(*) AS item_count
        FROM work_items
        INNER JOIN workflow_statuses AS statuses
            ON statuses.id = work_items.status_id
        WHERE work_items.project_id IN (${placeholders})
            AND work_items.archived_at IS NULL
        GROUP BY work_items.project_id, statuses.is_done;
      `,
      parameters,
    );

    for (const row of rows) {
      const projectId = readTextColumn(row, 0, "project_id");
      const isDone = readCountColumn(row, 1, "is_done") === 1;
      const count = readCountColumn(row, 2, "item_count");
      const current = countsByProject.get(projectId) ?? { done: 0, total: 0 };

      countsByProject.set(projectId, {
        done: current.done + (isDone ? count : 0),
        total: current.total + count,
      });
    }

    return countsByProject;
  }

  /** Returns one non-archived work item by identifier. */
  public async findById(id: string): Promise<WorkItemDetail | null> {
    const items = await this.querySingleWorkItem("work_items.id = $id", { id });

    return items;
  }

  /** Returns one non-archived work item by its key (e.g. PAGE-12). */
  public async findByKey(key: string): Promise<WorkItemDetail | null> {
    const items = await this.querySingleWorkItem("work_items.key = $key", {
      key,
    });

    return items;
  }

  /** Returns all non-archived subtasks belonging to a parent item. */
  public async findSubtasks(parentId: string): Promise<WorkItemDetail[]> {
    return this.queryWorkItemsByCondition(
      "work_items.parent_id = $parent_id AND work_items.archived_at IS NULL",
      { parent_id: parentId },
    );
  }

  /** Returns non-archived tasks of a project linked to a GitHub issue. */
  public async findLinkedWorkItems(
    projectId: string,
  ): Promise<WorkItemDetail[]> {
    return this.queryWorkItemsByCondition(
      "work_items.project_id = $project_id AND work_items.github_issue_number IS NOT NULL AND work_items.archived_at IS NULL",
      { project_id: projectId },
    );
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
            updated_at = CURRENT_TIMESTAMP
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
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      { id, github_conflict: conflict ? 1 : 0 },
    );
  }

  /** Inserts a new work item. */
  public async insert(item: NewWorkItem): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO work_items (
            id,
            project_id,
            key,
            number,
            type,
            parent_id,
            title,
            description,
            status_id,
            priority,
            assignee_id,
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
            $key,
            $number,
            $type,
            $parent_id,
            $title,
            $description,
            $status_id,
            $priority,
            $assignee_id,
            $created_by,
            $milestone_id,
            $due_at,
            $start_at,
            $sort_order,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        );
      `,
      {
        assignee_id: item.assigneeId,
        created_by: item.createdBy,
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
            created_by = $created_by,
            parent_id = $parent_id,
            milestone_id = $milestone_id,
            due_at = $due_at,
            start_at = $start_at,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      {
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
            completed_at = CASE WHEN $is_done = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
            updated_at = CURRENT_TIMESTAMP
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

  /** Marks a work item as archived without deleting its row. */
  public async archive(id: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE work_items
        SET
            archived_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      { id },
    );
  }

  /** Restores an archived work item keeping its original workflow status. */
  public async restore(id: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE work_items
        SET
            archived_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id
            AND archived_at IS NOT NULL;
      `,
      { id },
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
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id;
      `,
      { id, github_last_error: message },
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
  public async moveToProject(
    id: string,
    move: {
      readonly projectId: string;
      readonly key: string;
      readonly number: number;
      readonly parentId: string | null;
      readonly milestoneId: string | null;
      readonly assigneeId: string | null;
    },
  ): Promise<void> {
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
            updated_at = CURRENT_TIMESTAMP
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

  /** Returns the shared label catalog of a project ordered by name. */
  public async findLabelsByProjectId(
    projectId: string,
  ): Promise<ProjectLabel[]> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            name,
            color,
            created_at,
            updated_at
        FROM project_labels
        WHERE project_id = $project_id
        ORDER BY name ASC;
      `,
      { project_id: projectId },
    );

    return rows.map((row) => this.toProjectLabel(row));
  }

  /** Returns the shared label catalogs of several projects ordered by name. */
  public async findLabelsByProjectIds(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly ProjectLabel[]>> {
    const labelsByProject = new Map<string, ProjectLabel[]>();

    if (projectIds.length === 0) {
      return labelsByProject;
    }

    const placeholders = projectIds
      .map((_, index) => `$label_project_id_${index}`)
      .join(", ");
    const parameters: Record<string, string> = {};

    for (const [index, projectId] of projectIds.entries()) {
      parameters[`label_project_id_${index}`] = projectId;
    }

    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            name,
            color,
            created_at,
            updated_at
        FROM project_labels
        WHERE project_id IN (${placeholders})
        ORDER BY name ASC;
      `,
      parameters,
    );

    for (const row of rows) {
      const projectId = readTextColumn(row, 1, "project_id");
      const label = this.toProjectLabel(row);
      const assigned = labelsByProject.get(projectId);

      if (assigned) {
        assigned.push(label);
      } else {
        labelsByProject.set(projectId, [label]);
      }
    }

    return labelsByProject;
  }

  /** Returns a project label by its identifier. */
  public async findLabelById(id: string): Promise<ProjectLabel | null> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            name,
            color,
            created_at,
            updated_at
        FROM project_labels
        WHERE id = $id;
      `,
      { id },
    );
    const row = rows[0];

    return row ? this.toProjectLabel(row) : null;
  }

  /** Returns how many tickets currently use a label. */
  public async countLabelUsage(labelId: string): Promise<number> {
    const rows = await this.database.query(
      `
        SELECT
            COUNT(*) AS usage_count
        FROM work_item_labels
        WHERE label_id = $label_id;
      `,
      { label_id: labelId },
    );
    const row = rows[0];

    if (!row) {
      return 0;
    }

    return readCountColumn(row, 0, "usage_count");
  }

  /**
   * Returns label usage counts for several projects with a single query.
   *
   * @returns Usage counts grouped by project id, then by label id.
   */
  public async countLabelUsageByProjectIds(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, ReadonlyMap<string, number>>> {
    const usageByProject = new Map<string, Map<string, number>>();

    if (projectIds.length === 0) {
      return usageByProject;
    }

    const placeholders = projectIds
      .map((_, index) => `$usage_project_id_${index}`)
      .join(", ");
    const parameters: Record<string, string> = {};

    for (const [index, projectId] of projectIds.entries()) {
      parameters[`usage_project_id_${index}`] = projectId;
    }

    const rows = await this.database.query(
      `
        SELECT
            project_labels.project_id,
            work_item_labels.label_id,
            COUNT(*) AS usage_count
        FROM work_item_labels
        INNER JOIN project_labels
            ON project_labels.id = work_item_labels.label_id
        WHERE project_labels.project_id IN (${placeholders})
        GROUP BY project_labels.project_id, work_item_labels.label_id;
      `,
      parameters,
    );

    for (const row of rows) {
      const projectId = readTextColumn(row, 0, "project_id");
      const labelId = readTextColumn(row, 1, "label_id");
      const count = readCountColumn(row, 2, "usage_count");
      let usage = usageByProject.get(projectId);

      if (!usage) {
        usage = new Map<string, number>();
        usageByProject.set(projectId, usage);
      }

      usage.set(labelId, count);
    }

    return usageByProject;
  }

  /** Inserts a label into the shared catalog of a project. */
  public async insertLabel(label: {
    readonly id: string;
    readonly projectId: string;
    readonly name: string;
    readonly color: string;
  }): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO project_labels (
            id,
            project_id,
            name,
            color,
            created_at,
            updated_at
        )
        VALUES (
            $id,
            $project_id,
            $name,
            $color,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        );
      `,
      {
        color: label.color,
        id: label.id,
        name: label.name,
        project_id: label.projectId,
      },
    );
  }

  /** Renames or recolors a project label; tickets reference it by id. */
  public async updateLabel(
    id: string,
    label: { readonly name: string; readonly color: string },
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE project_labels
        SET
            name = $name,
            color = $color,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id;
      `,
      { id, name: label.name, color: label.color },
    );
  }

  /** Deletes a project label and all of its ticket assignments. */
  public async deleteLabel(id: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM work_item_labels
        WHERE label_id = $label_id;
      `,
      { label_id: id },
    );
    await this.database.execute(
      `
        DELETE FROM project_labels
        WHERE id = $id;
      `,
      { id },
    );
  }

  /** Returns the labels of the given work items mapped by work item id. */
  public async findLabelsForWorkItemIds(
    workItemIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly ProjectLabel[]>> {
    const labelsByWorkItem = new Map<string, ProjectLabel[]>();

    if (workItemIds.length === 0) {
      return labelsByWorkItem;
    }

    const placeholders = workItemIds
      .map((_, index) => `$work_item_id_${index}`)
      .join(", ");
    const parameters: Record<string, string> = {};

    for (const [index, workItemId] of workItemIds.entries()) {
      parameters[`work_item_id_${index}`] = workItemId;
    }

    const rows = await this.database.query(
      `
        SELECT
            work_item_labels.work_item_id,
            project_labels.id,
            project_labels.project_id,
            project_labels.name,
            project_labels.color,
            project_labels.created_at,
            project_labels.updated_at
        FROM work_item_labels
        INNER JOIN project_labels
            ON project_labels.id = work_item_labels.label_id
        WHERE work_item_labels.work_item_id IN (${placeholders})
        ORDER BY project_labels.name ASC;
      `,
      parameters,
    );

    for (const row of rows) {
      const workItemId = readTextColumn(row, 0, "work_item_id");
      const label = this.toProjectLabel(row.slice(1));
      const assigned = labelsByWorkItem.get(workItemId);

      if (assigned) {
        assigned.push(label);
      } else {
        labelsByWorkItem.set(workItemId, [label]);
      }
    }

    return labelsByWorkItem;
  }

  /** Assigns a project label to a work item. */
  public async assignLabel(workItemId: string, labelId: string): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO work_item_labels (
            work_item_id,
            label_id
        )
        VALUES (
            $work_item_id,
            $label_id
        )
        ON CONFLICT (work_item_id, label_id) DO NOTHING;
      `,
      { label_id: labelId, work_item_id: workItemId },
    );
  }

  /** Removes a project label from a work item. */
  public async unassignLabel(
    workItemId: string,
    labelId: string,
  ): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM work_item_labels
        WHERE work_item_id = $work_item_id
            AND label_id = $label_id;
      `,
      { label_id: labelId, work_item_id: workItemId },
    );
  }

  /** Removes every label assignment from a work item. */
  public async removeAllLabelsFromWorkItem(workItemId: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM work_item_labels
        WHERE work_item_id = $work_item_id;
      `,
      { work_item_id: workItemId },
    );
  }

  /** Returns the checklist items of a work item, in their persisted order. */
  public async findChecklistItemsByWorkItemId(
    workItemId: string,
  ): Promise<WorkItemChecklistItem[]> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            work_item_id,
            title,
            is_done,
            sort_order,
            created_at,
            updated_at
        FROM work_item_checklist_items
        WHERE work_item_id = $work_item_id
        ORDER BY sort_order ASC, created_at ASC;
      `,
      { work_item_id: workItemId },
    );

    return rows.map((row) => this.toWorkItemChecklistItem(row));
  }

  /** Returns a single checklist item by its identifier. */
  public async findChecklistItemById(
    id: string,
  ): Promise<WorkItemChecklistItem | null> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            work_item_id,
            title,
            is_done,
            sort_order,
            created_at,
            updated_at
        FROM work_item_checklist_items
        WHERE id = $id;
      `,
      { id },
    );
    const row = rows[0];

    return row ? this.toWorkItemChecklistItem(row) : null;
  }

  /** Appends a checklist item after the ticket's existing entries. */
  public async insertChecklistItem(item: {
    readonly id: string;
    readonly workItemId: string;
    readonly title: string;
  }): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO work_item_checklist_items (
            id,
            work_item_id,
            title,
            sort_order,
            created_at,
            updated_at
        )
        VALUES (
            $id,
            $work_item_id,
            $title,
            (
                SELECT COALESCE(MAX(sort_order), 0) + 1
                FROM work_item_checklist_items
                WHERE work_item_id = $work_item_id
            ),
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        );
      `,
      { id: item.id, title: item.title, work_item_id: item.workItemId },
    );
  }

  /** Renames a checklist item, toggles its done state, or both. */
  public async updateChecklistItem(
    id: string,
    update: { readonly title: string; readonly isDone: boolean },
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE work_item_checklist_items
        SET
            title = $title,
            is_done = $is_done,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id;
      `,
      { id, is_done: update.isDone ? 1 : 0, title: update.title },
    );
  }

  /** Deletes a checklist item. */
  public async deleteChecklistItem(id: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM work_item_checklist_items
        WHERE id = $id;
      `,
      { id },
    );
  }

  /**
   * Returns every link involving a work item, from that item's own point
   * of view (outgoing rows stored on it, plus incoming rows stored on the
   * other side of the relation).
   */
  public async findLinksByWorkItemId(
    workItemId: string,
  ): Promise<WorkItemLink[]> {
    const rows = await this.database.query(
      `
        SELECT
            work_item_links.id,
            work_item_links.link_type,
            'outgoing' AS direction,
            work_items.id AS linked_work_item_id,
            work_items.key AS linked_work_item_key,
            work_items.title AS linked_work_item_title,
            workflow_statuses.key AS linked_work_item_status_key,
            workflow_statuses.is_done AS linked_work_item_is_done,
            work_item_links.created_at AS created_at
        FROM work_item_links
        INNER JOIN work_items
            ON work_items.id = work_item_links.linked_work_item_id
        INNER JOIN workflow_statuses
            ON workflow_statuses.id = work_items.status_id
        WHERE work_item_links.work_item_id = $work_item_id

        UNION ALL

        SELECT
            work_item_links.id,
            work_item_links.link_type,
            'incoming' AS direction,
            work_items.id AS linked_work_item_id,
            work_items.key AS linked_work_item_key,
            work_items.title AS linked_work_item_title,
            workflow_statuses.key AS linked_work_item_status_key,
            workflow_statuses.is_done AS linked_work_item_is_done,
            work_item_links.created_at AS created_at
        FROM work_item_links
        INNER JOIN work_items
            ON work_items.id = work_item_links.work_item_id
        INNER JOIN workflow_statuses
            ON workflow_statuses.id = work_items.status_id
        WHERE work_item_links.linked_work_item_id = $work_item_id;
      `,
      { work_item_id: workItemId },
    );

    return rows.map((row) => this.toWorkItemLink(row));
  }

  /** Returns a single link by its identifier. */
  public async findLinkById(id: string): Promise<{
    readonly id: string;
    readonly workItemId: string;
    readonly linkedWorkItemId: string;
    readonly linkType: WorkItemLinkType;
  } | null> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            work_item_id,
            linked_work_item_id,
            link_type
        FROM work_item_links
        WHERE id = $id;
      `,
      { id },
    );
    const row = rows[0];

    if (!row) {
      return null;
    }

    const linkType = readTextColumn(row, 3, "link_type");

    if (!isWorkItemLinkType(linkType)) {
      throw new Error(
        `Database returned an unsupported link type "${linkType}".`,
      );
    }

    return {
      id: readTextColumn(row, 0, "id"),
      linkType,
      linkedWorkItemId: readTextColumn(row, 2, "linked_work_item_id"),
      workItemId: readTextColumn(row, 1, "work_item_id"),
    };
  }

  /** Persists a new link between two work items. */
  public async insertLink(link: {
    readonly id: string;
    readonly workItemId: string;
    readonly linkedWorkItemId: string;
    readonly linkType: WorkItemLinkType;
  }): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO work_item_links (
            id,
            work_item_id,
            linked_work_item_id,
            link_type,
            created_at
        )
        VALUES (
            $id,
            $work_item_id,
            $linked_work_item_id,
            $link_type,
            CURRENT_TIMESTAMP
        )
        ON CONFLICT (work_item_id, linked_work_item_id, link_type) DO NOTHING;
      `,
      {
        id: link.id,
        link_type: link.linkType,
        linked_work_item_id: link.linkedWorkItemId,
        work_item_id: link.workItemId,
      },
    );
  }

  /** Deletes a link by its identifier. */
  public async deleteLink(id: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM work_item_links
        WHERE id = $id;
      `,
      { id },
    );
  }

  /** Records a history event for a work item. */
  public async insertHistory(entry: NewWorkItemHistory): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO work_item_history (
            id,
            work_item_id,
            user_id,
            action,
            field,
            old_value,
            new_value,
            created_at
        )
        VALUES (
            $id,
            $work_item_id,
            $user_id,
            $action,
            $field,
            $old_value,
            $new_value,
            CURRENT_TIMESTAMP
        );
      `,
      {
        action: entry.action,
        field: entry.field,
        id: entry.id,
        new_value: entry.newValue,
        old_value: entry.oldValue,
        user_id: entry.userId,
        work_item_id: entry.workItemId,
      },
    );
  }

  /** Returns history records for a work item ordered from newest to oldest. */
  public async findHistoryByWorkItemId(
    workItemId: string,
  ): Promise<WorkItemHistory[]> {
    const rows = await this.database.query(
      `
        SELECT
            work_item_history.id,
            work_item_history.work_item_id,
            work_item_history.user_id,
            users.display_name AS user_display_name,
            work_item_history.action,
            work_item_history.field,
            work_item_history.old_value,
            work_item_history.new_value,
            work_item_history.created_at
        FROM work_item_history
        LEFT JOIN users
            ON users.id = work_item_history.user_id
        WHERE work_item_history.work_item_id = $work_item_id
        ORDER BY work_item_history.created_at DESC;
      `,
      { work_item_id: workItemId },
    );

    return rows.map((row) => this.toWorkItemHistory(row));
  }

  /** Returns all active users eligible to be assigned to work items in a project. */
  public async findEligibleAssignees(projectId: string): Promise<User[]> {
    const rows = await this.database.query(
      `
        SELECT
            users.id,
            users.username,
            users.display_name,
            users.role,
            users.is_active
        FROM users
        WHERE users.is_active = 1
            AND (
                users.role IN ('admin', 'manager')
                OR EXISTS (
                    SELECT 1
                    FROM project_members
                    WHERE project_members.project_id = $project_id
                        AND project_members.user_id = users.id
                )
            )
        ORDER BY users.display_name ASC;
      `,
      { project_id: projectId },
    );

    return rows.map((row) => this.toUser(row));
  }

  /**
   * Returns eligible assignees for several projects with a single query.
   *
   * @remarks
   * Administrators and managers are eligible in every requested project,
   * members only in their own projects, mirroring {@link findEligibleAssignees}.
   *
   * @returns Eligible users grouped by project id, ordered by display name.
   */
  public async findEligibleAssigneesByProjectIds(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly User[]>> {
    const assigneesByProject = new Map<string, Map<string, User>>();

    if (projectIds.length === 0) {
      return new Map<string, readonly User[]>();
    }

    for (const projectId of projectIds) {
      assigneesByProject.set(projectId, new Map<string, User>());
    }

    const placeholders = projectIds
      .map((_, index) => `$assignee_project_id_${index}`)
      .join(", ");
    const parameters: Record<string, string> = {};

    for (const [index, projectId] of projectIds.entries()) {
      parameters[`assignee_project_id_${index}`] = projectId;
    }

    const rows = await this.database.query(
      `
        SELECT
            users.id,
            users.username,
            users.display_name,
            users.role,
            users.is_active,
            members.project_id AS member_project_id
        FROM users
        LEFT JOIN project_members AS members
            ON members.user_id = users.id
            AND members.project_id IN (${placeholders})
        WHERE users.is_active = 1
            AND (
                users.role IN ('admin', 'manager')
                OR members.project_id IS NOT NULL
            )
        ORDER BY users.display_name ASC;
      `,
      parameters,
    );

    for (const row of rows) {
      const user = this.toUser(row.slice(0, 5));
      const memberProjectId = row[5];
      const targetProjectIds =
        user.role === "admin" || user.role === "manager"
          ? projectIds
          : typeof memberProjectId === "string"
            ? [memberProjectId]
            : [];

      for (const projectId of targetProjectIds) {
        assigneesByProject.get(projectId)?.set(user.id, user);
      }
    }

    const grouped = new Map<string, readonly User[]>();

    for (const [projectId, usersById] of assigneesByProject) {
      grouped.set(projectId, Array.from(usersById.values()));
    }

    return grouped;
  }

  private async querySingleWorkItem(
    condition: string,
    parameters: Record<string, string>,
  ): Promise<WorkItemDetail | null> {
    const results = await this.queryWorkItemsByCondition(condition, parameters);

    return results[0] ?? null;
  }

  private async queryWorkItemsByCondition(
    condition: string,
    parameters: Record<string, string>,
  ): Promise<WorkItemDetail[]> {
    const statement = `
      SELECT
          work_items.id,
          work_items.project_id,
          work_items.key,
          work_items.number,
          work_items.type,
          work_items.parent_id,
          work_items.title,
          work_items.description,
          work_items.status_id,
          work_items.priority,
          work_items.assignee_id,
          work_items.created_by,
          work_items.milestone_id,
          work_items.due_at,
          work_items.sort_order,
          work_items.created_at,
          work_items.updated_at,
          work_items.completed_at,
          work_items.archived_at,
          projects.name AS project_name,
          workflow_statuses.key AS status_key,
          workflow_statuses.name AS status_name,
          workflow_statuses.is_done AS is_done,
          assignee.display_name AS assignee_name,
          milestones.name AS milestone_name,
          parent.title AS parent_title,
          parent.key AS parent_key,
          COALESCE(subtasks.total, 0) AS subtask_total,
          COALESCE(subtasks.completed, 0) AS subtask_completed,
          work_items.github_issue_number,
          work_items.github_issue_url,
          work_items.github_issue_state,
          work_items.github_issue_updated_at,
          work_items.github_content_hash,
          work_items.github_conflict,
          work_items.github_last_sync_at,
          reporter.display_name AS reporter_name,
          work_items.start_at,
          work_items.github_last_error
      FROM work_items
      INNER JOIN projects
          ON projects.id = work_items.project_id
      INNER JOIN workflow_statuses
          ON workflow_statuses.id = work_items.status_id
      LEFT JOIN users AS assignee
          ON assignee.id = work_items.assignee_id
      LEFT JOIN users AS reporter
          ON reporter.id = work_items.created_by
      LEFT JOIN milestones
          ON milestones.id = work_items.milestone_id
      LEFT JOIN work_items AS parent
          ON parent.id = work_items.parent_id
      LEFT JOIN (
          SELECT
              child.parent_id,
              COUNT(*) AS total,
              SUM(CASE WHEN child_status.is_done = 1 THEN 1 ELSE 0 END) AS completed
          FROM work_items AS child
          INNER JOIN workflow_statuses AS child_status
              ON child_status.id = child.status_id
          WHERE child.archived_at IS NULL
          GROUP BY child.parent_id
      ) AS subtasks
          ON subtasks.parent_id = work_items.id
      WHERE ${condition}
      ORDER BY work_items.sort_order ASC, work_items.created_at DESC;
    `;

    const rows = await this.database.query(statement, parameters);

    return rows.map((row) => this.toWorkItemDetail(row));
  }

  private toWorkflowStatus(row: readonly DatabaseValue[]): WorkflowStatus {
    const rawProjectId = row[1];
    const projectId =
      rawProjectId === null ? null : readTextColumn(row, 1, "project_id");

    return {
      id: readTextColumn(row, 0, "id"),
      isDone: readBooleanColumn(row, 5, "is_done"),
      key: readTextColumn(row, 2, "key"),
      name: readTextColumn(row, 3, "name"),
      position: readCountColumn(row, 4, "position"),
      projectId,
    };
  }

  private toMilestone(row: readonly DatabaseValue[]): Milestone {
    const startAt = row[5] === null ? null : readTextColumn(row, 5, "start_at");
    const dueAt = row[6] === null ? null : readTextColumn(row, 6, "due_at");
    const completedAt =
      row[9] === null ? null : readTextColumn(row, 9, "completed_at");
    const archivedAt =
      row[10] === null ? null : readTextColumn(row, 10, "archived_at");
    const status = readTextColumn(row, 4, "status");

    return {
      archivedAt,
      completedAt,
      createdAt: readTextColumn(row, 7, "created_at"),
      description: readTextColumn(row, 3, "description"),
      dueAt,
      id: readTextColumn(row, 0, "id"),
      name: readTextColumn(row, 2, "name"),
      projectId: readTextColumn(row, 1, "project_id"),
      startAt,
      status: status === "completed" || status === "archived" ? status : "open",
      updatedAt: readTextColumn(row, 8, "updated_at"),
    };
  }

  private toProjectLabel(row: readonly DatabaseValue[]): ProjectLabel {
    return {
      color: readTextColumn(row, 3, "color"),
      createdAt: readTextColumn(row, 4, "created_at"),
      id: readTextColumn(row, 0, "id"),
      name: readTextColumn(row, 2, "name"),
      projectId: readTextColumn(row, 1, "project_id"),
      updatedAt: readTextColumn(row, 5, "updated_at"),
    };
  }

  private toWorkItemChecklistItem(
    row: readonly DatabaseValue[],
  ): WorkItemChecklistItem {
    return {
      createdAt: readTextColumn(row, 5, "created_at"),
      id: readTextColumn(row, 0, "id"),
      isDone: readBooleanColumn(row, 3, "is_done"),
      sortOrder: readCountColumn(row, 4, "sort_order"),
      title: readTextColumn(row, 2, "title"),
      updatedAt: readTextColumn(row, 6, "updated_at"),
      workItemId: readTextColumn(row, 1, "work_item_id"),
    };
  }

  private toWorkItemLink(row: readonly DatabaseValue[]): WorkItemLink {
    const linkType = readTextColumn(row, 1, "link_type");
    const direction = readTextColumn(row, 2, "direction");

    if (!isWorkItemLinkType(linkType)) {
      throw new Error(
        `Database returned an unsupported link type "${linkType}".`,
      );
    }

    if (direction !== "outgoing" && direction !== "incoming") {
      throw new Error(
        `Database returned an unsupported link direction "${direction}".`,
      );
    }

    return {
      createdAt: readTextColumn(row, 8, "created_at"),
      direction,
      id: readTextColumn(row, 0, "id"),
      linkType,
      linkedWorkItemId: readTextColumn(row, 3, "linked_work_item_id"),
      linkedWorkItemIsDone: readBooleanColumn(
        row,
        7,
        "linked_work_item_is_done",
      ),
      linkedWorkItemKey: readTextColumn(row, 4, "linked_work_item_key"),
      linkedWorkItemStatusKey: readTextColumn(
        row,
        6,
        "linked_work_item_status_key",
      ),
      linkedWorkItemTitle: readTextColumn(row, 5, "linked_work_item_title"),
    };
  }

  private toWorkItemDetail(row: readonly DatabaseValue[]): WorkItemDetail {
    const rawType = readTextColumn(row, 4, "type");
    const rawPriority = readTextColumn(row, 9, "priority");
    const rawIssueState = row[31];

    if (!isWorkItemType(rawType)) {
      throw new Error(
        `Database returned an unsupported work item type "${rawType}".`,
      );
    }

    if (!isWorkItemPriority(rawPriority)) {
      throw new Error(
        `Database returned an unsupported priority "${rawPriority}".`,
      );
    }

    if (rawIssueState !== null && !isGitHubIssueState(rawIssueState)) {
      throw new Error(
        `Database returned an unsupported GitHub issue state "${rawIssueState}".`,
      );
    }

    const githubIssueState = rawIssueState;

    const parentId =
      row[5] === null ? null : readTextColumn(row, 5, "parent_id");
    const assigneeId =
      row[10] === null ? null : readTextColumn(row, 10, "assignee_id");
    const milestoneId =
      row[12] === null ? null : readTextColumn(row, 12, "milestone_id");
    const dueAt = row[13] === null ? null : readTextColumn(row, 13, "due_at");
    const completedAt =
      row[17] === null ? null : readTextColumn(row, 17, "completed_at");
    const archivedAt =
      row[18] === null ? null : readTextColumn(row, 18, "archived_at");

    const assigneeName =
      row[23] === null ? null : readTextColumn(row, 23, "assignee_name");
    const milestoneName =
      row[24] === null ? null : readTextColumn(row, 24, "milestone_name");
    const parentTitle =
      row[25] === null ? null : readTextColumn(row, 25, "parent_title");
    const parentKey =
      row[26] === null ? null : readTextColumn(row, 26, "parent_key");

    const isDone = readBooleanColumn(row, 22, "is_done");
    const subtaskTotal = readCountColumn(row, 27, "subtask_total");
    const subtaskCompleted = readCountColumn(row, 28, "subtask_completed");
    const githubIssueNumber =
      row[29] === null ? null : readCountColumn(row, 29, "github_issue_number");
    const githubIssueUrl =
      row[30] === null ? null : readTextColumn(row, 30, "github_issue_url");
    const githubIssueUpdatedAt =
      row[32] === null
        ? null
        : readTextColumn(row, 32, "github_issue_updated_at");
    const githubContentHash =
      row[33] === null ? null : readTextColumn(row, 33, "github_content_hash");
    const githubLastSyncAt =
      row[35] === null ? null : readTextColumn(row, 35, "github_last_sync_at");
    const reporterName =
      row[36] === null ? null : readTextColumn(row, 36, "reporter_name");
    const startAt =
      row[37] === null ? null : readTextColumn(row, 37, "start_at");
    const githubLastError =
      row[38] === null ? null : readTextColumn(row, 38, "github_last_error");

    const progressPercentage =
      subtaskTotal > 0
        ? Math.round((subtaskCompleted / subtaskTotal) * 100)
        : isDone
          ? 100
          : 0;

    return {
      archivedAt,
      assigneeId,
      assigneeName,
      completedAt,
      createdAt: readTextColumn(row, 15, "created_at"),
      createdBy: readTextColumn(row, 11, "created_by"),
      description: readTextColumn(row, 7, "description"),
      dueAt,
      githubConflict: readBooleanColumn(row, 34, "github_conflict"),
      githubContentHash,
      githubIssueNumber,
      githubIssueState,
      githubIssueUpdatedAt,
      githubIssueUrl,
      githubLastError,
      githubLastSyncAt,
      id: readTextColumn(row, 0, "id"),
      isDone,
      key: readTextColumn(row, 2, "key"),
      milestoneId,
      milestoneName,
      number: readCountColumn(row, 3, "number"),
      parentId,
      parentKey,
      parentTitle,
      priority: rawPriority,
      progressPercentage,
      projectId: readTextColumn(row, 1, "project_id"),
      projectName: readTextColumn(row, 19, "project_name"),
      reporterName,
      sortOrder: readCountColumn(row, 14, "sort_order"),
      startAt,
      statusId: readTextColumn(row, 8, "status_id"),
      statusKey: readTextColumn(row, 20, "status_key"),
      statusName: readTextColumn(row, 21, "status_name"),
      subtaskCompleted,
      subtaskTotal,
      title: readTextColumn(row, 6, "title"),
      type: rawType,
      updatedAt: readTextColumn(row, 16, "updated_at"),
    };
  }

  private toWorkItemHistory(row: readonly DatabaseValue[]): WorkItemHistory {
    const userDisplayName =
      row[3] === null ? null : readTextColumn(row, 3, "user_display_name");
    const field = row[5] === null ? null : readTextColumn(row, 5, "field");
    const oldValue =
      row[6] === null ? null : readTextColumn(row, 6, "old_value");
    const newValue =
      row[7] === null ? null : readTextColumn(row, 7, "new_value");

    return {
      action: readTextColumn(row, 4, "action"),
      createdAt: readTextColumn(row, 8, "created_at"),
      field,
      id: readTextColumn(row, 0, "id"),
      newValue,
      oldValue,
      userDisplayName,
      userId: readTextColumn(row, 2, "user_id"),
      workItemId: readTextColumn(row, 1, "work_item_id"),
    };
  }

  private toUser(row: readonly DatabaseValue[]): User {
    const role = readTextColumn(row, 3, "role");

    if (!isRole(role)) {
      throw new Error(`Database returned an unsupported role "${role}".`);
    }

    return {
      displayName: readTextColumn(row, 2, "display_name"),
      id: readTextColumn(row, 0, "id"),
      isActive: readBooleanColumn(row, 4, "is_active"),
      role,
      username: readTextColumn(row, 1, "username"),
    };
  }
}
