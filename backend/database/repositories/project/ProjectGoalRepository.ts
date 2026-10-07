import {
  readBooleanColumn,
  readCountColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { ProjectGoal } from "@/definition/Project";

/** Values required to persist a project goal. */
export interface NewProjectGoal {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly position: number;
}

function toProjectGoal(row: readonly DatabaseValue[]): ProjectGoal {
  return {
    id: readTextColumn(row, 0, "id"),
    projectId: readTextColumn(row, 1, "project_id"),
    title: readTextColumn(row, 2, "title"),
    isDone: readBooleanColumn(row, 3, "is_done"),
    position: readCountColumn(row, 4, "position"),
  };
}

/** Owns persistence operations for project goals. */
export class ProjectGoalRepository {
  private readonly database: DatabaseTransaction;

  /**
   * Creates a project goal repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Returns the goals of a project ordered by position. */
  public async findByProjectId(projectId: string): Promise<ProjectGoal[]> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            project_id,
            title,
            is_done,
            position
        FROM project_goals
        WHERE project_id = $project_id
        ORDER BY position ASC, created_at ASC;
      `,
      { project_id: projectId },
    );

    return rows.map(toProjectGoal);
  }

  /** Inserts a goal for the project. */
  public async insert(goal: NewProjectGoal): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO project_goals (
            id,
            project_id,
            title,
            is_done,
            position
        )
        VALUES (
            $id,
            $project_id,
            $title,
            0,
            $position
        );
      `,
      {
        id: goal.id,
        project_id: goal.projectId,
        title: goal.title,
        position: goal.position,
      },
    );
  }

  /** Updates the title and completion state of a goal. */
  public async update(
    id: string,
    title: string,
    isDone: boolean,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE project_goals
        SET
            title = $title,
            is_done = $is_done
        WHERE id = $id;
      `,
      { id, title, is_done: isDone ? 1 : 0 },
    );
  }

  /** Deletes a goal. */
  public async delete(id: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM project_goals
        WHERE id = $id;
      `,
      { id },
    );
  }
}
