import { readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Stored descriptions, including archived tickets, for read-only file diagnostics. */
export interface TicketAssetAuditTicket {
  readonly id: string;
  readonly key: string;
  readonly description: string;
}

/** Reads the complete persisted reference set before cleanup or an administrator inventory. */
export class TicketAssetAuditRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Includes archived tickets because they can be restored with their images. */
  public async tickets(): Promise<TicketAssetAuditTicket[]> {
    const rows = await this.database.query(`
      SELECT id, key, description
      FROM work_items
      ORDER BY key, id;
    `);
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      key: readTextColumn(row, 1, "key"),
      description: readTextColumn(row, 2, "description"),
    }));
  }
}
