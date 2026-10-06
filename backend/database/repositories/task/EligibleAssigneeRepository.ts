import {
  readBooleanColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { isRole, ROLE } from "@/definition/Role";
import { isUserAvatarType } from "@/definition/User";

import { createInClause } from "./InClause";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { User } from "@/definition/User";

/** Columns of the user part of an assignee row, before the project membership column. */
const USER_COLUMN_COUNT = 10;

function toUser(row: readonly DatabaseValue[]): User {
  const role = readTextColumn(row, 3, "role");
  const avatarType = readTextColumn(row, 5, "avatar_type");

  if (!isRole(role)) {
    throw new Error(`Database returned an unsupported role "${role}".`);
  }

  if (!isUserAvatarType(avatarType)) {
    throw new Error(
      `Database returned an unsupported avatar type "${avatarType}".`,
    );
  }

  return {
    displayName: readTextColumn(row, 2, "display_name"),
    id: readTextColumn(row, 0, "id"),
    isActive: readBooleanColumn(row, 4, "is_active"),
    mustChangePassword: readBooleanColumn(row, 9, "must_change_password"),
    role,
    username: readTextColumn(row, 1, "username"),
    avatarType,
    avatarIcon: readNullableTextColumn(row, 6, "avatar_icon"),
    avatarColor: readNullableTextColumn(row, 7, "avatar_color"),
    avatarImageUrl: readNullableTextColumn(row, 8, "avatar_image_url"),
  };
}

/**
 * Lists the requested projects a user is eligible for.
 *
 * @remarks
 * Administrators and managers are eligible in every requested project,
 * members only in the project their membership row names.
 */
function resolveEligibleProjectIds(
  user: User,
  requestedProjectIds: readonly string[],
  memberProjectId: DatabaseValue | undefined,
): readonly string[] {
  if (user.role === ROLE.ADMIN || user.role === ROLE.MANAGER) {
    return requestedProjectIds;
  }

  return typeof memberProjectId === "string" ? [memberProjectId] : [];
}

function groupAssigneesByProject(
  rows: readonly (readonly DatabaseValue[])[],
  projectIds: readonly string[],
): ReadonlyMap<string, readonly User[]> {
  const assigneesByProject = new Map<string, Map<string, User>>();

  for (const projectId of projectIds) {
    assigneesByProject.set(projectId, new Map<string, User>());
  }

  for (const row of rows) {
    const user = toUser(row.slice(0, USER_COLUMN_COUNT));

    for (const projectId of resolveEligibleProjectIds(
      user,
      projectIds,
      row[USER_COLUMN_COUNT],
    )) {
      assigneesByProject.get(projectId)?.set(user.id, user);
    }
  }

  const grouped = new Map<string, readonly User[]>();

  for (const [projectId, usersById] of assigneesByProject) {
    grouped.set(projectId, Array.from(usersById.values()));
  }

  return grouped;
}

/** Owns the lookup of users who can be assigned to work items of a project. */
export class EligibleAssigneeRepository {
  private readonly database: Database;

  /**
   * Creates an eligible assignee repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Returns all active users eligible to be assigned to work items in a project. */
  public async findByProjectId(projectId: string): Promise<User[]> {
    const rows = await this.database.query(
      `
        SELECT
            users.id,
            users.username,
            users.display_name,
            users.role,
            users.is_active,
            users.avatar_type,
            users.avatar_icon,
            users.avatar_color,
            users.avatar_image_url,
            users.must_change_password
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

    return rows.map(toUser);
  }

  /**
   * Returns eligible assignees for several projects with a single query.
   *
   * @remarks
   * Administrators and managers are eligible in every requested project,
   * members only in their own projects, mirroring {@link findByProjectId}.
   *
   * @returns Eligible users grouped by project id, ordered by display name.
   */
  public async findByProjectIds(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly User[]>> {
    if (projectIds.length === 0) {
      return new Map<string, readonly User[]>();
    }

    const { parameters, placeholders } = createInClause(
      "assignee_project_id",
      projectIds,
    );
    const rows = await this.database.query(
      `
        SELECT
            users.id,
            users.username,
            users.display_name,
            users.role,
            users.is_active,
            users.avatar_type,
            users.avatar_icon,
            users.avatar_color,
            users.avatar_image_url,
            users.must_change_password,
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

    return groupAssigneesByProject(rows, projectIds);
  }
}
