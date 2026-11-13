import { readBooleanColumn, readTextColumn } from "@/backend/database/RowValue";

import { calendarInList } from "./CalendarSql";

import type { DatabaseValue } from "@/backend/database/Database";
import type { CalendarDatabase } from "./CalendarEventRepository";
import type { CalendarInviteeKind } from "@/definition/Calendar";

/** One account as the calendar names it. */
export interface CalendarAccountRecord {
  readonly id: string;
  readonly name: string;
  readonly isAgent: boolean;
  readonly isActive: boolean;
}

/** A group or department with its name. */
export interface CalendarNamedRecord {
  readonly id: string;
  readonly name: string;
}

/** A member of a group or department. */
export interface CalendarMembershipRecord {
  readonly containerId: string;
  readonly userId: string;
}

/** One choice of the invitation search. */
export interface CalendarInviteeOptionRecord {
  readonly kind: CalendarInviteeKind;
  readonly id: string;
  readonly name: string;
}

function toAccount(row: readonly DatabaseValue[]): CalendarAccountRecord {
  return {
    id: readTextColumn(row, 0, "id"),
    name: readTextColumn(row, 1, "display_name"),
    isAgent: readTextColumn(row, 2, "account_kind") === "agent",
    isActive: readBooleanColumn(row, 3, "is_active"),
  };
}

function toNamed(row: readonly DatabaseValue[]): CalendarNamedRecord {
  return {
    id: readTextColumn(row, 0, "id"),
    name: readTextColumn(row, 1, "name"),
  };
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

/**
 * Reads the people, agents, groups and departments the calendar invites and
 * resolves (PAGE-301).
 */
export class CalendarDirectoryRepository {
  private readonly database: CalendarDatabase;

  /**
   * Creates the repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: CalendarDatabase) {
    this.database = database;
  }

  /**
   * Returns the groups and departments an account belongs to now.
   *
   * @param userId - The account.
   */
  public async findMemberships(userId: string): Promise<{
    readonly groupIds: string[];
    readonly departmentIds: string[];
  }> {
    const groups = await this.database.query(
      "SELECT group_id FROM user_group_members WHERE user_id = $user_id ORDER BY group_id;",
      { user_id: userId },
    );
    const departments = await this.database.query(
      "SELECT department_id FROM department_members WHERE user_id = $user_id ORDER BY department_id;",
      { user_id: userId },
    );
    return {
      groupIds: groups.map((row) => readTextColumn(row, 0, "group_id")),
      departmentIds: departments.map((row) =>
        readTextColumn(row, 0, "department_id"),
      ),
    };
  }

  /**
   * Returns accounts by ID, removed accounts left out.
   *
   * @param ids - Account identifiers.
   */
  public async findAccounts(
    ids: readonly string[],
  ): Promise<CalendarAccountRecord[]> {
    const list = calendarInList("account_id", ids);
    const rows = await this.database.query(
      `
        SELECT
            id,
            display_name,
            account_kind,
            is_active
        FROM users
        WHERE id IN (${list.placeholders})
            AND removed_at IS NULL
        ORDER BY display_name, id;
      `,
      list.parameters,
    );
    return rows.map(toAccount);
  }

  /**
   * Returns groups by ID.
   *
   * @param ids - Group identifiers.
   */
  public async findGroups(
    ids: readonly string[],
  ): Promise<CalendarNamedRecord[]> {
    const list = calendarInList("group_id", ids);
    const rows = await this.database.query(
      `
        SELECT
            id,
            name
        FROM user_groups
        WHERE id IN (${list.placeholders})
        ORDER BY lower(name), id;
      `,
      list.parameters,
    );
    return rows.map(toNamed);
  }

  /**
   * Returns departments by ID.
   *
   * @param ids - Department identifiers.
   */
  public async findDepartments(
    ids: readonly string[],
  ): Promise<CalendarNamedRecord[]> {
    const list = calendarInList("department_id", ids);
    const rows = await this.database.query(
      `
        SELECT
            id,
            name
        FROM departments
        WHERE id IN (${list.placeholders})
        ORDER BY lower(name), id;
      `,
      list.parameters,
    );
    return rows.map(toNamed);
  }

  /**
   * Returns the current active members of groups.
   *
   * @param groupIds - Group identifiers.
   */
  public async findGroupMembers(
    groupIds: readonly string[],
  ): Promise<CalendarMembershipRecord[]> {
    const list = calendarInList("group_id", groupIds);
    const rows = await this.database.query(
      `
        SELECT
            user_group_members.group_id,
            user_group_members.user_id
        FROM user_group_members
        INNER JOIN users
            ON users.id = user_group_members.user_id
        WHERE user_group_members.group_id IN (${list.placeholders})
            AND users.removed_at IS NULL
            AND users.is_active = 1
        ORDER BY user_group_members.group_id, user_group_members.user_id;
      `,
      list.parameters,
    );
    return rows.map((row) => ({
      containerId: readTextColumn(row, 0, "group_id"),
      userId: readTextColumn(row, 1, "user_id"),
    }));
  }

  /**
   * Returns the current active members of departments.
   *
   * @param departmentIds - Department identifiers.
   */
  public async findDepartmentMembers(
    departmentIds: readonly string[],
  ): Promise<CalendarMembershipRecord[]> {
    const list = calendarInList("department_id", departmentIds);
    const rows = await this.database.query(
      `
        SELECT
            department_members.department_id,
            department_members.user_id
        FROM department_members
        INNER JOIN users
            ON users.id = department_members.user_id
        WHERE department_members.department_id IN (${list.placeholders})
            AND users.removed_at IS NULL
            AND users.is_active = 1
        ORDER BY department_members.department_id, department_members.user_id;
      `,
      list.parameters,
    );
    return rows.map((row) => ({
      containerId: readTextColumn(row, 0, "department_id"),
      userId: readTextColumn(row, 1, "user_id"),
    }));
  }

  /**
   * Searches whom an account may invite: active people and agents, as in
   * the chat, and every group and department, as in tickets.
   *
   * @param text - Part of a name; empty lists the first ones.
   * @param limit - Most options returned.
   */
  public async searchInvitees(
    text: string,
    limit: number,
  ): Promise<CalendarInviteeOptionRecord[]> {
    const pattern = `%${escapeLike(text.trim().toLowerCase())}%`;
    const rows = await this.database.query(
      `
        SELECT
            kind,
            id,
            name
        FROM (
            SELECT
                CASE WHEN account_kind = 'agent' THEN 'agent' ELSE 'person' END AS kind,
                id,
                display_name AS name
            FROM users
            WHERE removed_at IS NULL
                AND is_active = 1
                AND (lower(display_name) LIKE $pattern ESCAPE '\\' OR lower(username) LIKE $pattern ESCAPE '\\')
            UNION ALL
            SELECT
                'group' AS kind,
                id,
                name
            FROM user_groups
            WHERE lower(name) LIKE $pattern ESCAPE '\\'
            UNION ALL
            SELECT
                'department' AS kind,
                id,
                name
            FROM departments
            WHERE lower(name) LIKE $pattern ESCAPE '\\'
        ) AS options
        ORDER BY lower(name), kind, id
        LIMIT $limit;
      `,
      { pattern, limit },
    );
    return rows.flatMap((row) => {
      const kind = readTextColumn(row, 0, "kind");
      if (
        kind !== "person" &&
        kind !== "agent" &&
        kind !== "group" &&
        kind !== "department"
      )
        return [];
      return [
        {
          kind,
          id: readTextColumn(row, 1, "id"),
          name: readTextColumn(row, 2, "name"),
        },
      ];
    });
  }
}
