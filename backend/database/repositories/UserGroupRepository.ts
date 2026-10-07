import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";
import type { GroupSummary, UserGroup } from "@/definition/UserGroup";

/** SQL operations usable either directly or under an aggregate transaction. */
type GroupDatabase = Pick<Database, "query" | "execute" | "transaction">;

/** Owns persistence of user groups and their members. */
export class UserGroupRepository {
  private readonly database: GroupDatabase;

  /**
   * Creates a group repository.
   *
   * @param database - Central database access or an open transaction.
   */
  public constructor(database: GroupDatabase) {
    this.database = database;
  }

  /** Returns every group with its members, ordered by name. */
  public async findAll(): Promise<UserGroup[]> {
    const groups = await this.database.query(
      "SELECT id, name FROM user_groups ORDER BY lower(name), id;",
    );
    const members = await this.database.query(
      "SELECT group_id, user_id FROM user_group_members ORDER BY user_id;",
    );

    return groups.map((row) => {
      const id = readTextColumn(row, 0, "id");

      return {
        id,
        memberIds: members
          .filter((member) => member[0] === id)
          .map((member) => readTextColumn(member, 1, "user_id")),
        name: readTextColumn(row, 1, "name"),
      };
    });
  }

  /** Returns every group with its member count, ordered by name. */
  public async findSummaries(): Promise<GroupSummary[]> {
    const rows = await this.database.query(`
      SELECT
          user_groups.id,
          user_groups.name,
          COUNT(user_group_members.user_id) AS member_count
      FROM user_groups
      LEFT JOIN user_group_members
          ON user_group_members.group_id = user_groups.id
      GROUP BY user_groups.id, user_groups.name
      ORDER BY lower(user_groups.name), user_groups.id;
    `);

    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      memberCount: readCountColumn(row, 2, "member_count"),
      name: readTextColumn(row, 1, "name"),
    }));
  }

  /** Returns the summary of one group, or `null` when it does not exist. */
  public async findSummaryById(id: string): Promise<GroupSummary | null> {
    const rows = await this.database.query(
      `
      SELECT
          user_groups.id,
          user_groups.name,
          COUNT(user_group_members.user_id) AS member_count
      FROM user_groups
      LEFT JOIN user_group_members
          ON user_group_members.group_id = user_groups.id
      WHERE user_groups.id = $id
      GROUP BY user_groups.id, user_groups.name;
    `,
      { id },
    );
    const row = rows[0];

    return row
      ? {
          id: readTextColumn(row, 0, "id"),
          memberCount: readCountColumn(row, 2, "member_count"),
          name: readTextColumn(row, 1, "name"),
        }
      : null;
  }

  /** Returns the ids of the groups a user belongs to. */
  public async findIdsByMember(userId: string): Promise<string[]> {
    const rows = await this.database.query(
      `
      SELECT group_id
      FROM user_group_members
      WHERE user_id = $user_id
      ORDER BY group_id;
    `,
      { user_id: userId },
    );

    return rows.map((row) => readTextColumn(row, 0, "group_id"));
  }

  /** Inserts or renames a group and replaces its members. */
  public async save(group: UserGroup): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO user_groups (id, name)
      VALUES ($id, $name)
      ON CONFLICT (id) DO UPDATE SET name = excluded.name;
    `,
      { id: group.id, name: group.name },
    );
    await this.database.execute(
      "DELETE FROM user_group_members WHERE group_id = $id;",
      { id: group.id },
    );

    for (const userId of new Set(group.memberIds)) {
      await this.database.execute(
        "INSERT INTO user_group_members (group_id, user_id) VALUES ($id, $user_id);",
        { id: group.id, user_id: userId },
      );
    }
  }

  /** Deletes a group together with its members and the tickets' assignment to it. */
  public async delete(id: string): Promise<void> {
    await this.database.execute(
      "UPDATE work_items SET assignee_group_id = NULL WHERE assignee_group_id = $id;",
      { id },
    );
    await this.database.execute(
      "DELETE FROM user_group_members WHERE group_id = $id;",
      { id },
    );
    await this.database.execute("DELETE FROM user_groups WHERE id = $id;", {
      id,
    });
  }
}
