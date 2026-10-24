import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** Distinguishes removed registrations from registrations hidden by access rules. */
export class AgentPlanWorkspaceRepository {
  private readonly database: Pick<Database, "query">;

  public constructor(database: Pick<Database, "query">) {
    this.database = database;
  }

  /** Identifiers only, for server-side orphan detection; never exposed as choices. */
  public async registeredIds(): Promise<ReadonlySet<string>> {
    const rows = await this.database.query(`
      SELECT id FROM agent_workspaces
      UNION
      SELECT id FROM remote_workspaces;
    `);
    return new Set(rows.map((row) => readTextColumn(row, 0, "id")));
  }
}
