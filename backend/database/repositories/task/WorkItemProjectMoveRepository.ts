import { snapshotParameters } from "./WorkItemSnapshotSql";

import type { TaskDatabase } from "./TaskDatabase";
import type { TaskMoveSnapshot } from "@/definition/TaskUpdateSnapshot";

/** Target of moving a work item to another project. */
export interface WorkItemMove {
  readonly projectId: string;
  readonly key: string;
  readonly number: number;
  readonly parentId: string | null;
  readonly milestoneId: string | null;
  readonly assigneeId: string | null;
}

/** A move and the source fields that must still match when it is stored. */
export interface ConditionalWorkItemMove {
  readonly id: string;
  readonly move: WorkItemMove;
  readonly expected: TaskMoveSnapshot;
}

/** Rolls the complete project move back when a source row or the subtree changed. */
class ProjectMoveConflict extends Error {}

/** Owns persistence for moving work items between projects. */
export class WorkItemProjectMoveRepository {
  private readonly database: TaskDatabase;

  /** Binds project moves to the database or an existing transaction. */
  public constructor(database: TaskDatabase) {
    this.database = database;
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
    await this.writeProjectMove(id, move);
  }

  /** Moves a whole subtree atomically while all of its source values still match. */
  public async moveSubtreeIfCurrent(
    rootId: string,
    moves: readonly ConditionalWorkItemMove[],
  ): Promise<boolean> {
    try {
      await this.database.transaction(async (transaction) => {
        const rows = await transaction.query(
          `
            WITH RECURSIVE subtree AS (
                SELECT id FROM work_items WHERE id = $root_id
                UNION ALL
                SELECT child.id
                FROM work_items AS child
                JOIN subtree ON child.parent_id = subtree.id
                WHERE child.archived_at IS NULL
            )
            SELECT id FROM subtree;
          `,
          { root_id: rootId },
        );
        const expectedIds = new Set(moves.map((entry) => entry.id));
        if (
          rows.length !== expectedIds.size ||
          rows.some(
            (row) => typeof row[0] !== "string" || !expectedIds.has(row[0]),
          )
        )
          throw new ProjectMoveConflict();
        for (const entry of moves) {
          if (
            !(await this.writeProjectMove(
              entry.id,
              entry.move,
              entry.expected,
              transaction,
            ))
          ) {
            throw new ProjectMoveConflict();
          }
        }
      });
      return true;
    } catch (error: unknown) {
      if (error instanceof ProjectMoveConflict) return false;
      throw error;
    }
  }

  private async writeProjectMove(
    id: string,
    move: WorkItemMove,
    expected?: TaskMoveSnapshot,
    database: Pick<TaskDatabase, "query"> = this.database,
  ): Promise<boolean> {
    const rows = await database.query(
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
        WHERE id = $id
            AND (
                NOT $has_expected
                OR (
                    archived_at IS NULL
                    AND project_id = $base_project_id
                    AND github_issue_number IS NOT DISTINCT FROM $base_github_issue_number
                    AND title = $base_title
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
        RETURNING id;
      `,
      {
        assignee_id: move.assigneeId,
        base_project_id: expected?.projectId ?? null,
        base_github_issue_number: expected?.githubIssueNumber ?? null,
        id,
        key: move.key,
        milestone_id: move.milestoneId,
        number: move.number,
        parent_id: move.parentId,
        project_id: move.projectId,
        ...snapshotParameters(expected?.fields),
      },
    );
    return rows.length > 0;
  }
}
