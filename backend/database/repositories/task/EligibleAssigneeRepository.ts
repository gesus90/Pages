import {
  readBooleanColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { isRole } from "@/definition/Role";
import { isUserAvatarType } from "@/definition/User";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { User } from "@/definition/User";

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

/** Owns the lookup of users who can be assigned to work items. */
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

  /**
   * Returns every active user who could be assigned to a ticket.
   *
   * @remarks
   * Whether a person may work in a particular project is a decision of the
   * current account facts (department scope), taken by the service that
   * filters these candidates; no legacy role column takes part in it.
   */
  public async findCandidates(): Promise<User[]> {
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
        ORDER BY users.display_name ASC;
      `,
    );

    return rows.map(toUser);
  }

  /**
   * Returns the candidates once for every requested project.
   *
   * @param projectIds - Projects the caller asks candidates for.
   * @returns The same ordered candidates under each project id; the empty map
   * for no projects, without querying.
   */
  public async findByProjectIds(
    projectIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly User[]>> {
    if (projectIds.length === 0) {
      return new Map<string, readonly User[]>();
    }

    const candidates = await this.findCandidates();

    return new Map(projectIds.map((projectId) => [projectId, candidates]));
  }
}
