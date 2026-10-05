import {
  readBooleanColumn,
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { isProjectRole } from "@/definition/Project";
import { isUserAvatarType } from "@/definition/User";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { ProjectMember, ProjectRole } from "@/definition/Project";

function toProjectMember(row: readonly DatabaseValue[]): ProjectMember {
  const projectRole = readTextColumn(row, 7, "role");
  const avatarType = readTextColumn(row, 3, "avatar_type");

  if (!isProjectRole(projectRole)) {
    throw new Error(
      `Database returned an unsupported project role "${projectRole}".`,
    );
  }

  if (!isUserAvatarType(avatarType)) {
    throw new Error(
      `Database returned an unsupported avatar type "${avatarType}".`,
    );
  }

  return {
    userId: readTextColumn(row, 0, "user_id"),
    username: readTextColumn(row, 1, "username"),
    displayName: readTextColumn(row, 2, "display_name"),
    avatarType,
    avatarIcon: readNullableTextColumn(row, 4, "avatar_icon"),
    avatarColor: readNullableTextColumn(row, 5, "avatar_color"),
    avatarImageUrl: readNullableTextColumn(row, 6, "avatar_image_url"),
    projectRole,
    joinedAt: readTextColumn(row, 8, "joined_at"),
    isActive: readBooleanColumn(row, 9, "is_active"),
  };
}

/** Owns persistence operations for project memberships. */
export class ProjectMemberRepository {
  private readonly database: Database;

  /**
   * Creates a project member repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /** Returns whether the user belongs to the project. */
  public async isMember(projectId: string, userId: string): Promise<boolean> {
    const rows = await this.database.query(
      `
        SELECT
            COUNT(*)
        FROM project_members
        WHERE project_id = $project_id
            AND user_id = $user_id;
      `,
      { project_id: projectId, user_id: userId },
    );
    const row = rows[0];

    if (!row) {
      throw new Error("Database returned no membership count.");
    }

    return readCountColumn(row, 0, "member_count") > 0;
  }

  /** Returns whether the user holds the project manager role in the project. */
  public async isProjectManager(
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await this.database.query(
      `
        SELECT
            COUNT(*)
        FROM project_members
        WHERE project_id = $project_id
            AND user_id = $user_id
            AND role = 'manager';
      `,
      { project_id: projectId, user_id: userId },
    );
    const row = rows[0];

    if (!row) {
      throw new Error("Database returned no manager count.");
    }

    return readCountColumn(row, 0, "manager_count") > 0;
  }

  /** Returns every person assigned to the project with their project role. */
  public async findByProjectId(projectId: string): Promise<ProjectMember[]> {
    const rows = await this.database.query(
      `
        SELECT
            users.id,
            users.username,
            users.display_name,
            users.avatar_type,
            users.avatar_icon,
            users.avatar_color,
            users.avatar_image_url,
            project_members.role,
            project_members.joined_at,
            users.is_active
        FROM project_members
        INNER JOIN users
            ON users.id = project_members.user_id
        WHERE project_members.project_id = $project_id
        ORDER BY
            CASE project_members.role
                WHEN 'manager' THEN 0
                WHEN 'member' THEN 1
                ELSE 2
            END,
            users.display_name ASC;
      `,
      { project_id: projectId },
    );

    return rows.map(toProjectMember);
  }

  /** Adds a person to the project with the given project role. */
  public async add(
    projectId: string,
    userId: string,
    role: ProjectRole,
    joinedAt?: string,
  ): Promise<void> {
    await this.database.execute(
      `
        INSERT INTO project_members (
            project_id,
            user_id,
            role,
            joined_at
        )
        VALUES (
            $project_id,
            $user_id,
            $role,
            COALESCE($joined_at, utc_now())
        )
        ON CONFLICT (project_id, user_id) DO UPDATE SET
            role = excluded.role;
      `,
      {
        joined_at: joinedAt ?? null,
        project_id: projectId,
        user_id: userId,
        role,
      },
    );
  }

  /** Changes the project role of an assigned person. */
  public async updateRole(
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE project_members
        SET
            role = $role
        WHERE project_id = $project_id
            AND user_id = $user_id;
      `,
      { project_id: projectId, user_id: userId, role },
    );
  }

  /** Removes a person from the project. */
  public async remove(projectId: string, userId: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM project_members
        WHERE project_id = $project_id
            AND user_id = $user_id;
      `,
      { project_id: projectId, user_id: userId },
    );
  }
}
