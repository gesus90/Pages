import { readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { SqlParameters } from "@/backend/database/Database";
import type { Department } from "@/definition/Authorization";

/** Persists the multiple department assignments of a project. */
export class ProjectDepartmentRepository {
  private readonly database: DatabaseTransaction;

  /** Binds department operations to the database or current transaction. */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Returns current assignments with names from the live department catalog. */
  public async findByProjectId(projectId: string): Promise<Department[]> {
    const rows = await this.database.query(
      `
        SELECT
            departments.id,
            departments.name
        FROM project_departments
        INNER JOIN departments
            ON departments.id = project_departments.department_id
        WHERE project_departments.project_id = $project_id
        ORDER BY departments.name, departments.id;
      `,
      { project_id: projectId },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "department_id"),
      name: readTextColumn(row, 1, "department_name"),
    }));
  }

  /** Loads assignments for a project list in one query. */
  public async findByProjectIds(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, Department[]>> {
    if (projectIds.length === 0) return new Map();
    const parameters: Record<string, SqlParameters[string]> = {};
    const placeholders = projectIds.map((id, index) => {
      const name = `project_${index}`;
      parameters[name] = id;
      return `$${name}`;
    });
    const rows = await this.database.query(
      `
        SELECT
            project_departments.project_id,
            departments.id,
            departments.name
        FROM project_departments
        INNER JOIN departments
            ON departments.id = project_departments.department_id
        WHERE project_departments.project_id IN (${placeholders.join(", ")})
        ORDER BY departments.name, departments.id;
      `,
      parameters,
    );
    const assignments = new Map<string, Department[]>();
    for (const row of rows) {
      const projectId = readTextColumn(row, 0, "project_id");
      const departments = assignments.get(projectId) ?? [];
      departments.push({
        id: readTextColumn(row, 1, "department_id"),
        name: readTextColumn(row, 2, "department_name"),
      });
      assignments.set(projectId, departments);
    }
    return assignments;
  }

  /** Replaces assignments inside the caller's validation and write transaction. */
  public async replace(
    projectId: string,
    departmentIds: readonly string[],
  ): Promise<void> {
    await this.database.execute(
      "DELETE FROM project_departments WHERE project_id = $project_id;",
      { project_id: projectId },
    );
    for (const departmentId of new Set(departmentIds)) {
      await this.database.execute(
        `
          INSERT INTO project_departments (
              project_id,
              department_id
          )
          VALUES ($project_id, $department_id);
        `,
        { project_id: projectId, department_id: departmentId },
      );
    }
  }
}
