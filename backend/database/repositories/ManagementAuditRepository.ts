import { readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Administrator-only audit records; callers never pass passwords or raw request bodies. */
export class ManagementAuditRepository {
  private readonly database: DatabaseTransaction;
  /** Shares the transaction of the audited operation. */
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }
  /** Records a completed action, including reads which have no changed database rows. */
  public async record(
    actorId: string,
    action: string,
    target: string,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO management_audit (actor_id, action, target, change)
      VALUES ($actor_id, $action, $target, '{}');
    `,
      { actor_id: actorId, action, target },
    );
  }
  /** Reads the newest audit events; authorization belongs to the service boundary. */
  public async list(): Promise<
    readonly {
      readonly id: string;
      readonly actorId: string;
      readonly at: string;
      readonly action: string;
      readonly target: string;
      readonly change: string;
    }[]
  > {
    const rows = await this.database.query(`
      SELECT id::TEXT, actor_id, occurred_at, action, target, change::TEXT
      FROM management_audit
      ORDER BY id DESC
      LIMIT 100;
    `);
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      actorId: readTextColumn(row, 1, "actor_id"),
      at: readTextColumn(row, 2, "occurred_at"),
      action: readTextColumn(row, 3, "action"),
      target: readTextColumn(row, 4, "target"),
      change: readTextColumn(row, 5, "change"),
    }));
  }
}
