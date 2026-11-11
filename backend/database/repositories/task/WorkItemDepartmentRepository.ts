import { readTextColumn } from "@/backend/database/RowValue";

import type { TaskDatabase } from "./TaskDatabase";

/** Whether two id lists hold the same ids, regardless of order and repeats. */
function hasSameIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((departmentId) => rightSet.has(departmentId))
  );
}

type QueryAccess = Pick<TaskDatabase, "query">;
type ExecuteAccess = Pick<TaskDatabase, "execute">;

async function selectDepartmentIds(
  database: QueryAccess,
  id: string,
): Promise<string[]> {
  const rows = await database.query(
    `
      SELECT
          ticket_department.department_id
      FROM work_item_departments AS ticket_department
      LEFT JOIN departments
          ON departments.id = ticket_department.department_id
      WHERE ticket_department.work_item_id = $id
      ORDER BY lower(departments."name"), ticket_department.department_id;
    `,
    { id },
  );

  return rows.map((row) => readTextColumn(row, 0, "department_id"));
}

async function insertDepartmentIds(
  database: ExecuteAccess,
  id: string,
  departmentIds: readonly string[],
): Promise<void> {
  for (const departmentId of new Set(departmentIds)) {
    await database.execute(
      `
        INSERT INTO work_item_departments (
            work_item_id,
            department_id
        )
        VALUES (
            $work_item_id,
            $department_id
        );
      `,
      { work_item_id: id, department_id: departmentId },
    );
  }
}

/** Persists the set of departments of a ticket; an empty set means visible project-wide. */
export class WorkItemDepartmentRepository {
  private readonly database: TaskDatabase;

  /**
   * Creates the repository.
   *
   * @param database - Ticket database or the scope of an open transaction.
   */
  public constructor(database: TaskDatabase) {
    this.database = database;
  }

  /**
   * Reads the department ids of a ticket, ordered by department name.
   *
   * @param id - Ticket identifier.
   * @returns The ids, or an empty list for a ticket without department.
   */
  public async find(id: string): Promise<string[]> {
    return selectDepartmentIds(this.database, id);
  }

  /**
   * Adds departments to a new ticket.
   *
   * @param id - Ticket identifier.
   * @param departmentIds - Departments to add; repeats are ignored.
   */
  public async insert(
    id: string,
    departmentIds: readonly string[],
  ): Promise<void> {
    await insertDepartmentIds(this.database, id, departmentIds);
  }

  /**
   * Replaces the departments of an active ticket with a new set.
   *
   * @param id - Ticket whose departments change.
   * @param departmentIds - The new set; empty makes the ticket visible project-wide.
   * @param expected - When given, the stored set must still equal it.
   * @returns `false` when the ticket is gone, archived, or the expectation is stale.
   */
  public async replace(
    id: string,
    departmentIds: readonly string[],
    expected?: readonly string[],
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const locked = await transaction.query(
        `
          SELECT id
          FROM work_items
          WHERE id = $id
              AND archived_at IS NULL
          FOR UPDATE;
        `,
        { id },
      );
      if (locked.length === 0) return false;
      if (
        expected !== undefined &&
        !hasSameIds(await selectDepartmentIds(transaction, id), expected)
      )
        return false;
      await transaction.execute(
        "DELETE FROM work_item_departments WHERE work_item_id = $id;",
        { id },
      );
      await insertDepartmentIds(transaction, id, departmentIds);
      await transaction.execute(
        "UPDATE work_items SET updated_at = utc_now() WHERE id = $id;",
        { id },
      );

      return true;
    });
  }
}
