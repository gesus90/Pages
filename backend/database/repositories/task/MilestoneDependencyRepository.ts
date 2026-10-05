import { readTextColumn } from "@/backend/database/RowValue";
import { isMilestoneLinkType } from "@/definition/Task";

import { createInClause } from "./InClause";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { MilestoneDependency, MilestoneLinkType } from "@/definition/Task";

/** Values required to persist a directed dependency between two milestones. */
export interface NewMilestoneDependency {
  readonly id: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly linkType: MilestoneLinkType;
}

function toMilestoneDependency(
  row: readonly DatabaseValue[],
): MilestoneDependency {
  const linkType = readTextColumn(row, 4, "link_type");

  if (!isMilestoneLinkType(linkType)) {
    throw new Error("Database returned an invalid milestone link type.");
  }

  return {
    createdAt: readTextColumn(row, 5, "created_at"),
    id: readTextColumn(row, 0, "id"),
    linkType,
    projectId: readTextColumn(row, 1, "project_id"),
    sourceId: readTextColumn(row, 2, "source_id"),
    targetId: readTextColumn(row, 3, "target_id"),
  };
}

/** Owns persistence operations for dependencies between milestones. */
export class MilestoneDependencyRepository {
  private readonly database: Database;

  /**
   * Creates a milestone dependency repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Returns every dependency of the given projects. */
  public async findByProjectIds(
    projectIds: readonly string[],
  ): Promise<MilestoneDependency[]> {
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
            id,
            project_id,
            source_id,
            target_id,
            link_type,
            created_at
        FROM milestone_dependencies
        WHERE project_id IN (${placeholders})
        ORDER BY created_at ASC;
      `,
      parameters,
    );

    return rows.map(toMilestoneDependency);
  }

  /** Persists a directed dependency between two milestones. */
  public async insert(dependency: NewMilestoneDependency): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO milestone_dependencies (
            id,
            project_id,
            source_id,
            target_id,
            link_type
        )
        VALUES (
            $id,
            $project_id,
            $source_id,
            $target_id,
            $link_type
        );
      `,
      {
        id: dependency.id,
        project_id: dependency.projectId,
        source_id: dependency.sourceId,
        target_id: dependency.targetId,
        link_type: dependency.linkType,
      },
    );
  }

  /** Removes a single dependency by its identifier. */
  public async delete(id: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM milestone_dependencies
        WHERE id = $id;
      `,
      { id },
    );
  }

  /** Removes every dependency touching the given milestone. */
  public async deleteByMilestone(milestoneId: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM milestone_dependencies
        WHERE source_id = $milestone_id
            OR target_id = $milestone_id;
      `,
      { milestone_id: milestoneId },
    );
  }
}
