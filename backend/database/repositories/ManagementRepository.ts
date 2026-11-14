import { readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { ManagementReference } from "@/definition/Management";

/** Persistence for fields absent from the historical administration aggregate. */
export class ManagementRepository {
  private readonly database: DatabaseTransaction;
  /** Uses the transaction that owns the authorization decision and operation receipt. */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Reads an account's project memberships without returning backend credentials. */
  public async projects(
    userId: string,
  ): Promise<readonly (ManagementReference & { readonly role: string })[]> {
    const rows = await this.database.query(
      `
      SELECT projects.id, projects.name, project_members.role
      FROM project_members
      INNER JOIN projects ON projects.id = project_members.project_id
      WHERE project_members.user_id = $user_id
      ORDER BY projects.id;
    `,
      { user_id: userId },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      name: readTextColumn(row, 1, "name"),
      role: readTextColumn(row, 2, "role"),
    }));
  }

  /** Reads a group's descriptive text, which older group clients do not change. */
  public async description(groupId: string): Promise<string> {
    const rows = await this.database.query(
      "SELECT description FROM management_metadata WHERE target_type = 'group' AND target_id = $id;",
      { id: groupId },
    );
    return rows[0] ? readTextColumn(rows[0], 0, "description") : "";
  }

  /** Saves group prose beside the membership mutation in the same transaction. */
  public async setDescription(
    groupId: string,
    description: string,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO management_metadata (target_type, target_id, description)
      VALUES ('group', $id, $description)
      ON CONFLICT (target_type, target_id) DO UPDATE SET description = excluded.description;
    `,
      { id: groupId, description },
    );
  }
}
