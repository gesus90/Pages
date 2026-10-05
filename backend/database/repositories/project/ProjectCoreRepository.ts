import {
  readBooleanColumn,
  readCountColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { isProjectStatus } from "@/definition/Project";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { Project, ProjectStatus } from "@/definition/Project";

/** Values required to persist a new project. */
export interface NewProject {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly ownerId: string;
  readonly placeholderColor: string;
  readonly status: ProjectStatus;
}

/** Values that can be changed after a project is created. */
export interface ProjectUpdate {
  readonly name: string;
  readonly description: string;
  readonly status: ProjectStatus;
  readonly progress: number;
}

/** Extended values editable on the project detail page. */
export interface ProjectDetailsUpdate extends ProjectUpdate {
  readonly managerId: string | null;
  readonly startDate: string | null;
  readonly targetDate: string | null;
  readonly notes: string;
}

const PROJECT_COLUMNS = `
    projects.id,
    projects.parent_id,
    projects.name,
    COALESCE(projects.description, ''),
    projects.status,
    projects.progress,
    projects.placeholder_color,
    EXISTS (
        SELECT 1
        FROM project_icons
        WHERE project_icons.project_id = projects.id
    ),
    projects.manager_id,
    manager.display_name,
    projects.start_date,
    projects.target_date,
    COALESCE(projects.notes, ''),
    projects.created_at,
    projects.updated_at
`;

const PROJECT_JOIN_MANAGER = `
    LEFT JOIN users AS manager
        ON manager.id = projects.manager_id
`;

function toProject(row: readonly DatabaseValue[]): Project {
  const parentId = row[1];

  if (parentId !== null && typeof parentId !== "string") {
    throw new Error('Database returned an invalid value for "parent_id".');
  }

  const progress = readCountColumn(row, 5, "progress");
  const status = readTextColumn(row, 4, "status");

  if (!isProjectStatus(status)) {
    throw new Error(
      `Database returned an unsupported project status "${status}".`,
    );
  }

  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    throw new Error('Database returned an invalid value for "progress".');
  }

  const managerId = row[8];
  const managerName = row[9];
  const startDate = row[10];
  const targetDate = row[11];

  if (managerId !== null && typeof managerId !== "string") {
    throw new Error('Database returned an invalid value for "manager_id".');
  }

  if (managerName !== null && typeof managerName !== "string") {
    throw new Error('Database returned an invalid value for "manager_name".');
  }

  if (startDate !== null && typeof startDate !== "string") {
    throw new Error('Database returned an invalid value for "start_date".');
  }

  if (targetDate !== null && typeof targetDate !== "string") {
    throw new Error('Database returned an invalid value for "target_date".');
  }

  return {
    id: readTextColumn(row, 0, "id"),
    parentId,
    name: readTextColumn(row, 2, "name"),
    description: readTextColumn(row, 3, "description"),
    status,
    progress,
    placeholderColor: readTextColumn(row, 6, "placeholder_color"),
    hasIcon: readBooleanColumn(row, 7, "has_icon"),
    managerId,
    managerName,
    startDate,
    targetDate,
    notes: readTextColumn(row, 12, "notes"),
    createdAt: readTextColumn(row, 13, "created_at"),
    updatedAt: readTextColumn(row, 14, "updated_at"),
  };
}

/** Owns persistence operations for the project records themselves. */
export class ProjectCoreRepository {
  private readonly database: Database;

  /**
   * Creates a project core repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Returns every non-archived project ordered by most recent change. */
  public async findAll(): Promise<Project[]> {
    const rows = await this.database.query(`
      SELECT
          ${PROJECT_COLUMNS}
      FROM projects
      ${PROJECT_JOIN_MANAGER}
      WHERE projects.archived_at IS NULL
      ORDER BY projects.updated_at DESC, projects.name;
    `);

    return rows.map(toProject);
  }

  /** Returns the non-archived projects that include the given member. */
  public async findByMemberId(memberId: string): Promise<Project[]> {
    const rows = await this.database.query(
      `
        SELECT
            ${PROJECT_COLUMNS}
        FROM projects
        ${PROJECT_JOIN_MANAGER}
        INNER JOIN project_members
            ON project_members.project_id = projects.id
        WHERE project_members.user_id = $member_id
            AND projects.archived_at IS NULL
        ORDER BY projects.updated_at DESC, projects.name;
      `,
      { member_id: memberId },
    );

    return rows.map(toProject);
  }

  /** Returns a non-archived project by identifier. */
  public async findById(id: string): Promise<Project | null> {
    const rows = await this.database.query(
      `
        SELECT
            ${PROJECT_COLUMNS}
        FROM projects
        ${PROJECT_JOIN_MANAGER}
        WHERE projects.id = $id
            AND projects.archived_at IS NULL;
      `,
      { id },
    );

    const row = rows[0];

    return row ? toProject(row) : null;
  }

  /** Inserts a project and its owner membership. */
  public async insert(project: NewProject): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO projects (
            id,
            parent_id,
            name,
            description,
            owner_id,
            status,
            progress,
            placeholder_color,
            updated_at
        )
        VALUES (
            $id,
            NULL,
            $name,
            $description,
            $owner_id,
            $status,
            0,
            $placeholder_color,
            utc_now()
        );
      `,
      {
        id: project.id,
        name: project.name,
        description: project.description,
        owner_id: project.ownerId,
        status: project.status,
        placeholder_color: project.placeholderColor,
      },
    );
    await this.database.execute(
      `
        INSERT INTO project_members (
            project_id,
            user_id,
            role
        )
        VALUES (
            $project_id,
            $user_id,
            'manager'
        );
      `,
      { project_id: project.id, user_id: project.ownerId },
    );
  }

  /** Updates the editable values of a non-archived project. */
  public async update(id: string, project: ProjectUpdate): Promise<void> {
    await this.database.execute(
      `
        UPDATE projects
        SET
            name = $name,
            description = $description,
            status = $status,
            progress = $progress,
            updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      {
        id,
        name: project.name,
        description: project.description,
        status: project.status,
        progress: project.progress,
      },
    );
  }

  /** Updates the extended detail values of a non-archived project. */
  public async updateDetails(
    id: string,
    project: ProjectDetailsUpdate,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE projects
        SET
            name = $name,
            description = $description,
            status = $status,
            progress = $progress,
            manager_id = $manager_id,
            start_date = $start_date,
            target_date = $target_date,
            notes = $notes,
            updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      {
        id,
        name: project.name,
        description: project.description,
        status: project.status,
        progress: project.progress,
        manager_id: project.managerId,
        start_date: project.startDate,
        target_date: project.targetDate,
        notes: project.notes,
      },
    );
  }

  /** Marks a project as archived without deleting persisted data. */
  public async archive(id: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE projects
        SET
            archived_at = utc_now(),
            updated_at = utc_now()
        WHERE id = $id
            AND archived_at IS NULL;
      `,
      { id },
    );
  }
}
