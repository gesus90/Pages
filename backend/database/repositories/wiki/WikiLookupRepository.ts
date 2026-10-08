import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import { escapeLike } from "./WikiLinkRepository";
import { createInCondition } from "./WikiVisibility";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Looks up accounts and projects for the wiki. */
export class WikiLookupRepository {
  private readonly database: DatabaseTransaction;

  /**
   * Creates the repository.
   *
   * @param database - Database access or the transaction to run in.
   */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /**
   * Tells whether an active account exists.
   *
   * @param userId - Account identifier.
   * @returns Whether the account exists and is active.
   */
  public async isActiveUser(userId: string): Promise<boolean> {
    const rows = await this.database.query(
      "SELECT 1 FROM users WHERE id = $user_id AND is_active = 1;",
      { user_id: userId },
    );

    return rows.length > 0;
  }

  /**
   * Reads the display name of an account.
   *
   * @param userId - Account identifier.
   * @returns The name, or an empty text for an unknown account.
   */
  public async findUserName(userId: string): Promise<string> {
    const rows = await this.database.query(
      "SELECT display_name FROM users WHERE id = $user_id;",
      { user_id: userId },
    );
    const row = rows[0];

    return row ? readTextColumn(row, 0, "display_name") : "";
  }

  /**
   * Reads the names of projects.
   *
   * @param projectIds - Project identifiers.
   * @returns Identifier and name of each project that exists.
   */
  public async findProjectNames(
    projectIds: readonly string[],
  ): Promise<{ id: string; name: string }[]> {
    const projects = createInCondition("id", "project", projectIds);
    const rows = await this.database.query(
      `
        SELECT
            id,
            name
        FROM projects
        WHERE ${projects.sql}
        ORDER BY name, id;
      `,
      projects.parameters,
    );

    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      name: readTextColumn(row, 1, "name"),
    }));
  }

  /**
   * Lists the active accounts by name.
   *
   * @returns Identifier and display name of each active account.
   */
  public async listActiveUsers(): Promise<
    { id: string; displayName: string }[]
  > {
    const rows = await this.database.query(`
      SELECT
          id,
          display_name
      FROM users
      WHERE is_active = 1
      ORDER BY display_name, id;
    `);

    return rows.map((row) => ({
      displayName: readTextColumn(row, 1, "display_name"),
      id: readTextColumn(row, 0, "id"),
    }));
  }

  /**
   * Lists every department.
   *
   * @returns Identifier and name of each department.
   */
  public async listDepartments(): Promise<{ id: string; name: string }[]> {
    const rows = await this.database.query(`
      SELECT
          id,
          name
      FROM departments
      ORDER BY name, id;
    `);

    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      name: readTextColumn(row, 1, "name"),
    }));
  }

  /**
   * Lists the milestones of some projects.
   *
   * @param projectIds - Project identifiers.
   * @returns Milestones with the name of their project.
   */
  public async listMilestones(
    projectIds: readonly string[],
  ): Promise<
    { id: string; name: string; projectId: string; projectName: string }[]
  > {
    const projects = createInCondition(
      "milestone.project_id",
      "project",
      projectIds,
    );
    const rows = await this.database.query(
      `
        SELECT
            milestone.id,
            milestone.name,
            milestone.project_id,
            project.name
        FROM milestones AS milestone
        INNER JOIN projects AS project
            ON project.id = milestone.project_id
        WHERE ${projects.sql}
        ORDER BY project.name, milestone.name, milestone.id;
      `,
      projects.parameters,
    );

    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      name: readTextColumn(row, 1, "name"),
      projectId: readTextColumn(row, 2, "project_id"),
      projectName: readTextColumn(row, 3, "project_name"),
    }));
  }

  /**
   * Lists the epics of some projects.
   *
   * @param projectIds - Project identifiers.
   * @returns Epics with their key and department.
   */
  public async listEpics(projectIds: readonly string[]): Promise<
    {
      id: string;
      key: string;
      title: string;
      projectId: string;
      departmentId: string | null;
    }[]
  > {
    const projects = createInCondition(
      "epic.project_id",
      "project",
      projectIds,
    );
    const rows = await this.database.query(
      `
        SELECT
            epic.id,
            epic.key,
            epic.title,
            epic.project_id,
            epic.department_id
        FROM work_items AS epic
        WHERE epic.type = 'epic'
            AND ${projects.sql}
        ORDER BY epic.key;
      `,
      projects.parameters,
    );

    return rows.map((row) => ({
      departmentId: readNullableTextColumn(row, 4, "department_id"),
      id: readTextColumn(row, 0, "id"),
      key: readTextColumn(row, 1, "key"),
      projectId: readTextColumn(row, 3, "project_id"),
      title: readTextColumn(row, 2, "title"),
    }));
  }

  /**
   * Finds active accounts by name, for mentions.
   *
   * @param query - Text typed after the trigger.
   * @param limit - Largest number of accounts.
   * @returns Name and user name of each match.
   */
  public async searchUsers(
    query: string,
    limit: number,
  ): Promise<{ id: string; username: string; displayName: string }[]> {
    const rows = await this.database.query(
      `
        SELECT
            id,
            username,
            display_name
        FROM users
        WHERE is_active = 1
            AND NOT regexp_matches(username, '[\\s@()\\[\\]<>,;:!?"'']')
            AND (
                display_name ILIKE $pattern ESCAPE '\\'
                OR username ILIKE $pattern ESCAPE '\\'
            )
        ORDER BY display_name, id
        LIMIT ${Math.trunc(limit)};
      `,
      { pattern: `%${escapeLike(query)}%` },
    );

    return rows.map((row) => ({
      displayName: readTextColumn(row, 2, "display_name"),
      id: readTextColumn(row, 0, "id"),
      username: readTextColumn(row, 1, "username"),
    }));
  }

  /**
   * Finds active accounts by their user names.
   *
   * @param usernames - User names as written, in any case.
   * @returns The matching active accounts.
   */
  public async findActiveUsersByUsernames(
    usernames: readonly string[],
  ): Promise<{ id: string; username: string }[]> {
    const names = createInCondition(
      "lower(username)",
      "name",
      usernames.map((name) => name.toLowerCase()),
    );
    const rows = await this.database.query(
      `
        SELECT
            id,
            username
        FROM users
        WHERE is_active = 1
            AND ${names.sql}
        ORDER BY username, id;
      `,
      names.parameters,
    );

    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      username: readTextColumn(row, 1, "username"),
    }));
  }
}
