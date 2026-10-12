import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import { createInClause } from "./InClause";

import type { TaskDatabase } from "./TaskDatabase";

/** One link between a milestone and an initiative of the same project. */
export interface MilestoneInitiativeLink {
  readonly milestoneId: string;
  readonly initiativeId: string;
}

/** Owns the many-to-many links between milestones and initiatives. */
export class MilestoneInitiativeRepository {
  private readonly database: TaskDatabase;

  /**
   * Creates a milestone initiative repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: TaskDatabase) {
    this.database = database;
  }

  /**
   * Returns the links of the milestones of the given projects.
   *
   * @param projectIds - Projects whose active milestones are read.
   * @returns Linked and own-milestone initiatives, each pair once.
   *
   * @remarks
   * An initiative belongs to its own `milestone_id` as well as to every row of
   * the link table. Both count as one relation here, and a row only counts
   * while the milestone and the initiative lie in the same project.
   */
  public async findByProjectIds(
    projectIds: readonly string[],
  ): Promise<MilestoneInitiativeLink[]> {
    if (projectIds.length === 0) {
      return [];
    }

    const { parameters, placeholders } = createInClause(
      "project_id",
      projectIds,
    );
    const rows = await this.database.query(
      `
        SELECT
            milestone_initiatives.milestone_id AS milestone_id,
            milestone_initiatives.initiative_id AS initiative_id
        FROM milestone_initiatives
        INNER JOIN milestones
            ON milestones.id = milestone_initiatives.milestone_id
        INNER JOIN work_items
            ON work_items.id = milestone_initiatives.initiative_id
        WHERE milestones.project_id IN (${placeholders})
            AND milestones.archived_at IS NULL
            AND work_items.project_id = milestones.project_id
            AND work_items.type = 'initiative'
        UNION
        SELECT
            work_items.milestone_id AS milestone_id,
            work_items.id AS initiative_id
        FROM work_items
        INNER JOIN milestones
            ON milestones.id = work_items.milestone_id
        WHERE work_items.project_id IN (${placeholders})
            AND work_items.type = 'initiative'
            AND milestones.project_id = work_items.project_id
            AND milestones.archived_at IS NULL
        ORDER BY milestone_id, initiative_id;
      `,
      parameters,
    );

    return rows.map((row) => ({
      initiativeId: readTextColumn(row, 1, "initiative_id"),
      milestoneId: readTextColumn(row, 0, "milestone_id"),
    }));
  }

  /** Links an initiative with a milestone; an existing link stays as it is. */
  public async insert(
    milestoneId: string,
    initiativeId: string,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO milestone_initiatives (
            milestone_id,
            initiative_id
        )
        VALUES (
            $milestone_id,
            $initiative_id
        )
        ON CONFLICT (milestone_id, initiative_id) DO NOTHING;
      `,
      { initiative_id: initiativeId, milestone_id: milestoneId },
    );
  }

  /** Removes the table row of one link. */
  public async delete(
    milestoneId: string,
    initiativeId: string,
  ): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM milestone_initiatives
        WHERE milestone_id = $milestone_id
            AND initiative_id = $initiative_id;
      `,
      { initiative_id: initiativeId, milestone_id: milestoneId },
    );
  }

  /**
   * Gives a work item a milestone only while it has none.
   *
   * @returns Whether the work item took the milestone.
   */
  public async setMilestoneIfEmpty(
    workItemId: string,
    milestoneId: string,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        UPDATE work_items
        SET
            milestone_id = $milestone_id,
            updated_at = utc_now()
        WHERE id = $id
            AND milestone_id IS NULL
            AND archived_at IS NULL
        RETURNING id;
      `,
      { id: workItemId, milestone_id: milestoneId },
    );

    return rows.length > 0;
  }

  /** Clears the milestone of a work item while it still holds the given one. */
  public async clearMilestone(
    workItemId: string,
    milestoneId: string,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE work_items
        SET
            milestone_id = NULL,
            updated_at = utc_now()
        WHERE id = $id
            AND milestone_id = $milestone_id;
      `,
      { id: workItemId, milestone_id: milestoneId },
    );
  }

  /**
   * Counts the active descendants of an initiative that carry a milestone.
   *
   * @param initiativeId - Initiative whose epics, tasks and subtasks count.
   * @param milestoneId - Milestone the descendants must carry.
   */
  public async countDependents(
    initiativeId: string,
    milestoneId: string,
  ): Promise<number> {
    const rows = await this.database.query(
      `
        WITH RECURSIVE descendants (id) AS (
            SELECT id
            FROM work_items
            WHERE parent_id = $initiative_id
            UNION
            SELECT work_items.id
            FROM work_items
            INNER JOIN descendants
                ON work_items.parent_id = descendants.id
        )
        SELECT COUNT(*) AS dependent_count
        FROM work_items
        INNER JOIN descendants
            ON descendants.id = work_items.id
        WHERE work_items.milestone_id = $milestone_id
            AND work_items.archived_at IS NULL;
      `,
      { initiative_id: initiativeId, milestone_id: milestoneId },
    );

    // An aggregate without GROUP BY always returns exactly one row.
    const [row] = rows;

    return readCountColumn(row, 0, "dependent_count");
  }
}
